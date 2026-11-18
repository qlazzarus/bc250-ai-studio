"""Read-only server view of the operator prompt dictionary (LLM-I03, LLM-R02).

The dictionary is authored exactly once, in
``frontend/src/prompt/dictionary.ts``. Python must not keep a hand-maintained
second copy, so ``config/prompt_dictionary.json`` is a generated mirror —
``scripts/gen-prompt-dictionary.mjs`` writes it, and
``backend/tests/test_proposal_api.py`` fails when the two drift.

What is mirrored, and why:

* ``id``/``category``/``active`` — the validator's whitelist and the model's catalogue.
* ``label_ko``/``aliases`` — the Korean search vocabulary the model needs to connect a
  user's words to an ID (LLM-R02). These are *not* rendered expressions.

What is deliberately **not** mirrored: ``mappings``, the per-family rendered text. The
final prompt is assembled in the browser by ``compileScene``; shipping expressions to
Python would create a second source of truth for the rendered output.
"""

import json
from dataclasses import dataclass
from pathlib import Path

from app.services.prompt_proposals import DictionaryEntryRef


@dataclass(frozen=True)
class ProposalDictionary:
    """The immutable snapshot one process validates against."""

    version: str
    entries: dict[str, DictionaryEntryRef]


def load_dictionary(path: Path | str) -> ProposalDictionary | None:
    """Load the mirror, or ``None`` when it is missing or malformed.

    A missing file is an installation problem, not a reason to refuse every other
    route: the caller stops advertising ``prompt_proposals`` and the endpoint
    answers ``not_configured``. Silently validating against an empty dictionary
    would instead reject every suggestion as ``not_in_dictionary``.
    """
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(value, dict):
        return None
    version = value.get("dictionary_version")
    raw = value.get("entries")
    if not isinstance(version, str) or not version.strip() or not isinstance(raw, list):
        return None
    entries: dict[str, DictionaryEntryRef] = {}
    for item in raw:
        if not isinstance(item, dict):
            return None
        entry_id, category = item.get("id"), item.get("category")
        active = item.get("active", True)
        label_ko = item.get("label_ko", "")
        aliases = item.get("aliases", [])
        if not isinstance(entry_id, str) or not entry_id.strip():
            return None
        if not isinstance(category, str) or not category.strip():
            return None
        if type(active) is not bool or entry_id in entries:
            return None
        # LLM-R02 fields are optional so an older mirror still loads; when present
        # they must be the right shape, because they go straight into the prompt.
        if not isinstance(label_ko, str):
            return None
        if not isinstance(aliases, list) or any(
                not isinstance(alias, str) or not alias.strip() for alias in aliases):
            return None
        entries[entry_id] = DictionaryEntryRef(category, active, label_ko, tuple(aliases))
    if not entries:
        return None
    return ProposalDictionary(version=version, entries=entries)


def cached(holder, settings) -> ProposalDictionary | None:
    """Load the mirror once per process and keep it on the given app state.

    Passing ``holder`` in keeps this module free of web-framework imports. A minimal
    settings object without the path attribute (as some tests and older embeddings
    use) simply means "no proposals", the same as a missing file.
    """
    if not hasattr(holder, "prompt_dictionary"):
        path = getattr(settings, "prompt_dictionary_path", None)
        holder.prompt_dictionary = load_dictionary(path) if path is not None else None
    return holder.prompt_dictionary
