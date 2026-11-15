import copy
import json

from app.main import create_app
from conftest import HEADERS, submit, wait_job
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
        assert client.get('/api/v1/system/capabilities').json()['prompt_composition']['schema_versions'] == [1]
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
