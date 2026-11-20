import copy
import json

from app.core.studio_config import Settings
from app.main import create_app
from conftest import ADMIN_KEY, CLIENT_KEY, HEADERS, submit, wait_job
from fastapi.testclient import TestClient
from test_api import FailOnce


def composition():
    return {
        "schema_version": 1,
        "compiler_version": "1.0.0",
        "target_family": "fake",
        "selections": [{"id": "subject.person", "category": "subject", "label_ko": "인물",
                        "dictionary_version": "1.0.0", "mapping_status": "unavailable",
                        "rendered": None}],
        "free_text_ko": "비 오는 거리",
        "draft_prompt": "original draft",
        "unresolved": [{"kind": "free_text", "text": "비 오는 거리"}],
    }


def test_snapshot_retry_asset_and_events(settings):
    with TestClient(create_app(settings, engine=FailOnce()), headers=HEADERS) as client:
        assert client.get('/api/v1/system/capabilities').json()['prompt_composition']['schema_versions'] == [1, 2]
        original = composition()
        response = client.post('/api/v1/jobs', json={'model_id': 'fake', 'prompt': 'edited final',
                                                     'prompt_composition': original})
        assert response.status_code == 202, response.text
        first = wait_job(client, response.json()['job_id'])
        assert first['status'] == 'failed'
        assert first['prompt_composition']['free_text_ko'] == original['free_text_ko']
        retried = client.post(f"/api/v1/jobs/{first['job_id']}/retry")
        second = wait_job(client, retried.json()['job_id'])
        assert second['prompt_composition'] == first['prompt_composition']
        assert second['prompt'] == 'edited final'
        metadata = client.get(f"/api/v1/assets/{second['output_asset_ids'][0]}/metadata").json()
        assert metadata['prompt_composition'] == first['prompt_composition']
        events = client.get(f"/api/v1/jobs/{second['job_id']}/events").text
        assert 'prompt_composition' in events
        sidecar = next((settings.data_dir / 'outputs').rglob('*.json'))
        assert json.loads(sidecar.read_text())['prompt_composition'] == first['prompt_composition']


def test_legacy_and_invalid_inputs(client):
    old = wait_job(client, submit(client))
    assert old['prompt_composition'] is None
    assert client.get(f"/api/v1/assets/{old['output_asset_ids'][0]}/metadata").json()['prompt_composition'] is None
    bad = composition()
    bad['target_family'] = 'sd15'
    assert client.post('/api/v1/jobs', json={'model_id': 'fake', 'prompt': 'x', 'prompt_composition': bad}).status_code == 422
    bad = composition()
    bad['selections'].append(copy.deepcopy(bad['selections'][0]))
    assert client.post('/api/v1/jobs', json={'model_id': 'fake', 'prompt': 'x', 'prompt_composition': bad}).status_code == 422
    bad = composition()
    bad['unrecognized'] = 'no'
    assert client.post('/api/v1/jobs', json={'model_id': 'fake', 'prompt': 'x', 'prompt_composition': bad}).status_code == 422
    bad = composition()
    bad['free_text_ko'] = '\x00'
    assert client.post('/api/v1/jobs', json={'model_id': 'fake', 'prompt': 'x', 'prompt_composition': bad}).status_code == 422


def test_composition_size_and_mapping_validation(client):
    bad = composition()
    bad['selections'][0]['mapping_status'] = 'mapped'
    assert client.post(
        '/api/v1/jobs', json={'model_id': 'fake', 'prompt': 'x', 'prompt_composition': bad}
    ).status_code == 422
    bad = composition()
    bad['free_text_ko'] = '한' * 4000
    bad['unresolved'] = [{'kind': 'free_text', 'text': '한' * 4000} for _ in range(3)]
    assert client.post(
        '/api/v1/jobs', json={'model_id': 'fake', 'prompt': 'x', 'prompt_composition': bad}
    ).status_code == 422


def test_capabilities_reports_configured_http_limit(client, settings):
    response = client.get('/api/v1/system/capabilities')
    assert response.json()['request_limits']['max_body_bytes'] == settings.max_body_bytes


def test_verbatim_draft_keeps_original_and_manual_final(client):
    original = composition()
    original['free_text_ko'] = '  한글 English <lora:token:1> (tag:1.2)\n😀  '
    original['draft_prompt'] = original['free_text_ko']
    original['unresolved'] = [{'kind': 'free_text', 'text': original['free_text_ko']}]
    response = client.post('/api/v1/jobs', json={
        'model_id': 'fake', 'prompt': 'manually edited final', 'prompt_composition': original,
    })
    assert response.status_code == 202
    job = wait_job(client, response.json()['job_id'])
    metadata = client.get(f"/api/v1/assets/{job['output_asset_ids'][0]}/metadata").json()
    assert metadata['prompt'] == 'manually edited final'
    assert metadata['prompt_composition']['free_text_ko'] == original['free_text_ko']
    assert metadata['prompt_composition']['draft_prompt'] == original['draft_prompt']
    assert metadata['prompt_composition']['unresolved'][0]['text'] == original['free_text_ko']


# TRANS01/TRANS05: schema v2 keeps a v1 snapshot byte-identical while still accepting
# the new `remainder` field.
REMAINDER = {
    "source_ko": "비 오는 밤",
    "suggested_en": "a rainy night",
    "proposal_id": "prop-0123456789",
    "proposal_model": "qwen-test",
    "accepted_at": "2026-11-19T10:00:00Z",
}


def v2(remainder=(REMAINDER,), **changes):
    payload = composition()
    payload["schema_version"] = 2
    payload["remainder"] = list(remainder)
    payload.update(changes)
    return payload


def test_a_v1_snapshot_is_stored_without_a_remainder_key(client):
    """TRANS01 §2.4: read a v1 snapshot as v1 and never re-bind it to v2."""
    payload = composition()
    response = client.post('/api/v1/jobs', json={
        'model_id': 'fake', 'prompt': 'x', 'prompt_composition': payload})
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json()['job_id'])
    # No `remainder: []` is added: the field did not exist in the recorded fact.
    assert 'remainder' not in job['prompt_composition']
    assert job['prompt_composition']['schema_version'] == 1


def test_a_v2_snapshot_round_trips_through_job_metadata_and_sidecar(client, settings):
    payload = v2()
    response = client.post('/api/v1/jobs', json={
        'model_id': 'fake', 'prompt': 'x', 'prompt_composition': payload})
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json()['job_id'])
    assert job['prompt_composition']['schema_version'] == 2
    assert job['prompt_composition']['remainder'] == [REMAINDER]
    metadata = client.get(
        f"/api/v1/assets/{job['output_asset_ids'][0]}/metadata").json()
    assert metadata['prompt_composition']['remainder'] == [REMAINDER]
    sidecar = next((settings.data_dir / 'outputs').rglob('*.json'))
    assert json.loads(sidecar.read_text())['prompt_composition']['remainder'] == [REMAINDER]


def test_a_v2_body_without_remainder_is_an_empty_array(client):
    payload = v2(remainder=())
    del payload['remainder']
    response = client.post('/api/v1/jobs', json={
        'model_id': 'fake', 'prompt': 'x', 'prompt_composition': payload})
    assert response.status_code == 202, response.text
    job = wait_job(client, response.json()['job_id'])
    assert job['prompt_composition']['remainder'] == []


def test_retry_copies_the_composition_without_recompiling(settings):
    """A retry re-uses the recorded snapshot: no recompile, no re-assembly.

    `draft_prompt` must still equal the compiler output after the retry, and the
    accepted translations must survive verbatim — a retry that re-derived either
    from the current dictionary would rewrite history.
    """
    payload = v2()
    with TestClient(create_app(settings, engine=FailOnce()), headers=HEADERS) as client:
        response = client.post('/api/v1/jobs', json={
            'model_id': 'fake', 'prompt': 'a person\n' + REMAINDER['suggested_en'],
            'prompt_composition': payload})
        assert response.status_code == 202, response.text
        first = wait_job(client, response.json()['job_id'])
        assert first['status'] == 'failed'
        retried = client.post(f"/api/v1/jobs/{first['job_id']}/retry")
        assert retried.status_code == 202, retried.text
        second = wait_job(client, retried.json()['job_id'])
        assert second['status'] == 'completed'
        assert second['prompt_composition'] == first['prompt_composition']
        assert second['prompt_composition']['remainder'] == [REMAINDER]
        assert second['prompt_composition']['draft_prompt'] == payload['draft_prompt']
        assert second['prompt'] == first['prompt']


def test_a_v2_record_survives_a_model_family_change(tmp_path):
    """TRANS06: a family rebind must not cost the translations or their provenance.

    The composer keeps the applied composition across a mid-session family change, so the
    next apply is a re-save under a different `target_family` carrying the same
    `remainder`. This fixes the server half of that with two real fake families: both
    bodies are accepted, every provenance field comes back verbatim, and the first job's
    record is not rewritten by the second.
    """
    registry = tmp_path / 'models.yaml'
    registry.write_text(
        'models:\n'
        '- model_id: fake\n  display_name: Fake\n  family: fake\n  engine: fake\n'
        '  supported_resolutions: [[64, 64]]\n  supported_parameters: [width, height, steps, seed]\n'
        '  presets:\n    balanced: {width: 64, height: 64, steps: 1, cfg_scale: 1.0}\n'
        '- model_id: fake2\n  display_name: Fake 2\n  family: fake2\n  engine: fake\n'
        '  supported_resolutions: [[64, 64]]\n  supported_parameters: [width, height, steps, seed]\n'
        '  presets:\n    balanced: {width: 64, height: 64, steps: 1, cfg_scale: 1.0}\n'
    )
    settings = Settings(
        data_dir=tmp_path / 'data', api_key=CLIENT_KEY, admin_key=ADMIN_KEY,
        policy='image_priority', poll_interval=0.01, fake_delay=0.01, registry_path=registry,
    )
    with TestClient(create_app(settings), headers=HEADERS) as client:
        final = 'a person\n' + REMAINDER['suggested_en']
        first = v2()
        response = client.post('/api/v1/jobs', json={
            'model_id': 'fake', 'prompt': final, 'prompt_composition': first})
        assert response.status_code == 202, response.text
        before = wait_job(client, response.json()['job_id'])
        assert before['prompt_composition']['remainder'] == [REMAINDER]

        # The rebind only moves the target family; the accepted translations stay.
        rebound = v2(target_family='fake2', draft_prompt='recompiled for fake2')
        response = client.post('/api/v1/jobs', json={
            'model_id': 'fake2', 'prompt': final, 'prompt_composition': rebound})
        assert response.status_code == 202, response.text
        after = wait_job(client, response.json()['job_id'])
        assert after['prompt_composition']['schema_version'] == 2
        assert after['prompt_composition']['target_family'] == 'fake2'
        assert after['prompt_composition']['remainder'] == [REMAINDER]
        # Provenance is per item and survives the re-save unchanged.
        for field in ('source_ko', 'suggested_en', 'proposal_id', 'proposal_model', 'accepted_at'):
            assert after['prompt_composition']['remainder'][0][field] == REMAINDER[field]
        # The final prompt is the submitted one: no re-assembly, no duplicated English.
        assert after['prompt'] == final
        assert after['prompt'].count(REMAINDER['suggested_en']) == 1
        # The earlier job's record was not rewritten by the later save.
        again = client.get(f"/api/v1/jobs/{before['job_id']}").json()
        assert again['prompt_composition'] == before['prompt_composition']
        assert again['prompt_composition']['target_family'] == 'fake'


def test_remainder_never_reaches_the_final_prompt(client):
    """`draft_prompt` stays the compiler output; assembly happens in `applyDraft`."""
    payload = v2()
    response = client.post('/api/v1/jobs', json={
        'model_id': 'fake', 'prompt': 'a person', 'prompt_composition': payload})
    job = wait_job(client, response.json()['job_id'])
    assert job['prompt'] == 'a person'
    assert job['prompt_composition']['draft_prompt'] == payload['draft_prompt']
    assert 'rainy night' not in job['prompt_composition']['draft_prompt']


def test_a_v1_body_carrying_remainder_is_refused(client):
    """`extra="forbid"` per version: a v2 key under v1 must not be silently dropped."""
    payload = composition()
    payload['remainder'] = [REMAINDER]
    assert client.post('/api/v1/jobs', json={
        'model_id': 'fake', 'prompt': 'x', 'prompt_composition': payload}).status_code == 422


def test_an_incomplete_or_invalid_remainder_item_is_refused(client):
    for change in (
        {'proposal_id': None},          # provenance is mandatory per item
        {'proposal_model': None},
        {'accepted_at': None},
        {'accepted_at': '2026-11-19 10:00:00Z'},   # not the ISO-8601 UTC contract
        {'source_ko': '   '},
        {'suggested_en': ''},
        {'source_ko': '한' * 201},
        {'extra': 'no'},
    ):
        item = {**REMAINDER, **change}
        payload = v2(remainder=[{k: v for k, v in item.items() if v is not None}])
        assert client.post('/api/v1/jobs', json={
            'model_id': 'fake', 'prompt': 'x',
            'prompt_composition': payload}).status_code == 422, change


def test_more_than_eight_remainder_items_are_refused(client):
    payload = v2(remainder=[REMAINDER] * 8)
    assert client.post('/api/v1/jobs', json={
        'model_id': 'fake', 'prompt': 'x', 'prompt_composition': payload}).status_code == 202
    payload = v2(remainder=[REMAINDER] * 9)
    assert client.post('/api/v1/jobs', json={
        'model_id': 'fake', 'prompt': 'x', 'prompt_composition': payload}).status_code == 422


def test_a_v2_snapshot_over_32_kib_is_refused_even_with_remainder(client):
    """TRANS01 §3.1: 32 KiB stays the single binding budget."""
    payload = v2()
    payload['free_text_ko'] = '한' * 4000
    payload['draft_prompt'] = 'a' * 8000
    payload['unresolved'] = [{'kind': 'free_text', 'text': '한' * 4000} for _ in range(3)]
    assert client.post('/api/v1/jobs', json={
        'model_id': 'fake', 'prompt': 'x', 'prompt_composition': payload}).status_code == 422


def test_a_v2_record_survives_a_server_restart(tmp_path):
    """U12: a stored record must be readable by a *different* process.

    Every other v2 test reads back through the app that wrote the row, so a bug that
    kept the snapshot in memory (or in the engine's spec) and only re-emitted it while
    warm would still pass. Restarting on the same data directory is the only way to
    distinguish "stored" from "remembered": the second app shares nothing but the
    sqlite file and the sidecar.
    """
    settings = Settings(
        data_dir=tmp_path / 'data', api_key=CLIENT_KEY, admin_key=ADMIN_KEY,
        policy='image_priority', poll_interval=0.01, fake_delay=0.01,
    )
    payload = v2()
    final = 'a person\n' + REMAINDER['suggested_en']
    with TestClient(create_app(settings), headers=HEADERS) as client:
        response = client.post('/api/v1/jobs', json={
            'model_id': 'fake', 'prompt': final, 'prompt_composition': payload})
        assert response.status_code == 202, response.text
        before = wait_job(client, response.json()['job_id'])
        assert before['status'] == 'completed'
        asset_id = before['output_asset_ids'][0]
        # The file on disk, read before the restart, is what must still be there.
        sidecar = next((settings.data_dir / 'outputs').rglob('*.json'))
        assert json.loads(sidecar.read_text())['prompt_composition']['remainder'] == [REMAINDER]

    # Second process, same data directory, no shared memory.
    with TestClient(create_app(settings), headers=HEADERS) as client:
        job = client.get(f"/api/v1/jobs/{before['job_id']}").json()
        assert job['prompt_composition']['schema_version'] == 2
        assert job['prompt_composition']['remainder'] == [REMAINDER]
        assert job['prompt'] == final

        metadata = client.get(f"/api/v1/assets/{asset_id}/metadata").json()
        assert metadata['prompt_composition']['remainder'] == [REMAINDER]
        # Provenance is per item and is re-read from the row, not from a live dictionary.
        for field in ('source_ko', 'suggested_en', 'proposal_id', 'proposal_model',
                      'accepted_at'):
            assert metadata['prompt_composition']['remainder'][0][field] == REMAINDER[field]

        # The sidecar is a separate copy: corrupting only the DB would still leave this
        # true, so assert it after the restart rather than trusting the pre-restart read.
        assert json.loads(sidecar.read_text())['prompt_composition']['remainder'] == [REMAINDER]


def test_a_restored_v2_job_retries_across_a_restart_with_its_translations(tmp_path):
    """U12: retry is the path a user takes after a failure, possibly the next day.

    A retry deep-copies the stored spec, so it also proves the spec column — not just
    the asset metadata — still carries `remainder` after a restart.
    """
    settings = Settings(
        data_dir=tmp_path / 'data', api_key=CLIENT_KEY, admin_key=ADMIN_KEY,
        policy='image_priority', poll_interval=0.01, fake_delay=0.01,
    )
    with TestClient(create_app(settings, engine=FailOnce()), headers=HEADERS) as client:
        response = client.post('/api/v1/jobs', json={
            'model_id': 'fake', 'prompt': 'a person\n' + REMAINDER['suggested_en'],
            'prompt_composition': v2()})
        assert response.status_code == 202, response.text
        failed = wait_job(client, response.json()['job_id'])
        assert failed['status'] == 'failed'

    with TestClient(create_app(settings), headers=HEADERS) as client:
        stored = client.get(f"/api/v1/jobs/{failed['job_id']}").json()
        assert stored['prompt_composition']['remainder'] == [REMAINDER]

        retried = client.post(f"/api/v1/jobs/{failed['job_id']}/retry")
        assert retried.status_code == 202, retried.text
        second = wait_job(client, retried.json()['job_id'])
        assert second['status'] == 'completed'
        assert second['retry_of'] == failed['job_id']
        # The copy kept the version and every provenance field, and did not recompile.
        assert second['prompt_composition'] == stored['prompt_composition']
        assert second['prompt_composition']['remainder'] == [REMAINDER]
        assert second['prompt'] == stored['prompt']
        assert second['prompt'].count(REMAINDER['suggested_en']) == 1


def test_a_restarted_server_still_refuses_a_v1_body_with_remainder(tmp_path):
    """The version guard is validation, not process state: it must reload with the app."""
    settings = Settings(
        data_dir=tmp_path / 'data', api_key=CLIENT_KEY, admin_key=ADMIN_KEY,
        policy='image_priority', poll_interval=0.01, fake_delay=0.01,
    )
    with TestClient(create_app(settings), headers=HEADERS) as client:
        assert client.get('/api/v1/system/capabilities').json()[
            'prompt_composition']['schema_versions'] == [1, 2]

    assert (settings.data_dir / 'database' / 'studio.sqlite3').is_file()
    with TestClient(create_app(settings), headers=HEADERS) as client:
        assert client.get('/api/v1/system/capabilities').json()[
            'prompt_composition']['schema_versions'] == [1, 2]
        bad = composition()
        bad['remainder'] = [REMAINDER]
        assert client.post('/api/v1/jobs', json={
            'model_id': 'fake', 'prompt': 'x',
            'prompt_composition': bad}).status_code == 422


def test_remainder_fits_the_measured_budget():
    """TRANS01 §3.1/§7 baseline: v1 + 8 remainder items stays inside 32 KiB.

    The contract measured 19,243 → 26,849 B (+7,606) for the realistic maximum. This
    recomputes the same shape from the live models instead of trusting the number:
    if a field grows, the contract's headroom claim is what silently stops holding.
    """
    from app.models.schemas import PromptComposition
    from pydantic import TypeAdapter

    adapter = TypeAdapter(PromptComposition)
    selections = [
        {'id': f'subject.person{index}', 'category': 'subject', 'label_ko': '인물',
         'dictionary_version': '1.2.0', 'mapping_status': 'unavailable', 'rendered': None}
        for index in range(20)
    ]
    base = {
        'compiler_version': '1.3.0', 'target_family': 'sd15', 'selections': selections,
        'free_text_ko': '한' * 1000, 'draft_prompt': 'a' * 2000,
        'unresolved': [{'kind': 'free_text', 'text': '한' * 200}],
    }
    item = {'source_ko': '가' * 200, 'suggested_en': 'b' * 200,
            'proposal_id': 'prop-0123456789', 'proposal_model': 'qwen-test',
            'accepted_at': '2026-11-19T10:00:00Z'}

    def size(body):
        model = adapter.validate_python(body)
        return len(json.dumps(model.model_dump(mode='json'), ensure_ascii=False,
                              separators=(',', ':')).encode('utf-8'))

    without = size({'schema_version': 1, **base})
    with_remainder = size({'schema_version': 2, **base, 'remainder': [item] * 8})
    # The contract's +7,606 B is the cost of this field at its limits.
    assert with_remainder - without > 7000
    assert with_remainder <= 32768
