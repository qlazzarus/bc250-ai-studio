#!/usr/bin/env bash
# Standalone candidate provenance check; never installs or deploys artifacts.
set -Eeuo pipefail
[[ $# == 3 ]] || {
  echo '사용법: bash scripts/verify-candidate-attestation.sh GH경로 후보tar 예상커밋' >&2
  exit 1
}
gh_binary=$1
artifact=$2
commit=$3
[[ $gh_binary == /* && -x $gh_binary && -f $artifact && ! -L $artifact \
   && $commit =~ ^[0-9a-f]{40}$ ]] || {
  echo '검증 도구·후보 파일 또는 예상 커밋이 올바르지 않습니다.' >&2
  exit 1
}
"$gh_binary" attestation verify "$artifact" \
  --repo qlazzarus/bc250-ai-studio \
  --signer-workflow qlazzarus/bc250-ai-studio/.github/workflows/model-control-candidate.yml \
  --source-digest "$commit" \
  --source-ref refs/heads/main \
  --deny-self-hosted-runners
printf '%s\n' '후보 출처 서명 및 저장소·워크플로·커밋·브랜치 검사 완료; 설치하지 않았습니다.'
