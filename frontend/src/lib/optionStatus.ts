import { type GenerationOption } from "./../api";

function optionStatus(option: GenerationOption | undefined) {
  if (!option) return "서버 capability 정보 없음";
  if (option.mode === "experimental") return "실험적 · BC-250 실기 미검증";
  if (option.mode === "verified") return "검증된 현재 범위";
  if (option.mode === "unsupported") return "이 모델에서 지원하지 않음";
  return "모델 고정값";
}

export default optionStatus;