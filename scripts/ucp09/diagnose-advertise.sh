#!/usr/bin/env bash
# Say *why* prompt_compose/prompt_proposals are not advertised, on the host.
#
# Both capabilities share one last condition -- a non-empty `llm_model` -- so a
# single missing env var removes both, and the API reports it as "not configured"
# rather than as an error. This runs the deployed predicates in the deployed
# virtualenv, so the answer comes from the code that is actually serving traffic,
# not from a local copy. Read-only: no service is started, stopped or reloaded.
#
#   scripts/ucp09/diagnose-advertise.sh              # against the tunnel
#   UCP09_REMOTE=1 scripts/ucp09/diagnose-advertise.sh   # on the host itself
set -eu

APP=${UCP09_APP_DIR:-/opt/bc250-ai-studio}
SSH_Host=${UCP09_SSH_HOST:-yeppyshiba@yeppyshiba.iptime.org}
SSH_PORT=${UCP09_SSH_PORT:-2222}
SSH_KEY=${UCP09_SSH_KEY:-$HOME/.ssh/bc250_studio_maintenance}

read -r -d '' PROBE <<'PY' || true
import sys
sys.path.insert(0, "backend")

from app.services.prompt_compose import compose_advertised
from app.services.prompt_dictionary import load_dictionary
from app.services.proposal_provider import proposals_advertised


class Settings:
    """Only the attributes the two predicates read."""

    engine = "sdcpp"
    admission_url = "http://127.0.0.1:8081/control"
    llm_model = ""


dictionary = load_dictionary("config/prompt_dictionary.json")
print("dictionary   :", "loaded" if dictionary else "MISSING/MALFORMED",
      "| version:", dictionary.version if dictionary else "-",
      "| entries:", len(dictionary.entries) if dictionary else 0)

for label, model in (("llm_model empty", ""), ("llm_model set  ", "probe")):
    Settings.llm_model = model
    print(f"{label}: proposals={proposals_advertised(Settings, dictionary)}"
          f" compose={compose_advertised(Settings, dictionary)}")
PY

if [ "${UCP09_REMOTE:-0}" = 1 ]; then
    cd "$APP" && printf '%s\n' "$PROBE" | .venv/bin/python -
else
    printf '%s\n' "$PROBE" | ssh -i "$SSH_KEY" -p "$SSH_PORT" -o BatchMode=yes \
        "$SSH_Host" "cd $APP && .venv/bin/python -"
fi
