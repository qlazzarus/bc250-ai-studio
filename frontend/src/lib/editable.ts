import { type GenerationOption } from "./../api";

function editable(option: GenerationOption | undefined) {
  if (!option || option.mode === "fixed" || option.mode === "unsupported") return false;
  return option.allowed_values.length > 1 || option.minimum !== null || option.maximum !== null;
}

export default editable;