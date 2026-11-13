import { type GenerationOption } from "./../api";

function fixedValue(option: GenerationOption | undefined, fallback: string) {
  return option?.default === null || option?.default === undefined ? fallback : String(option.default);
}

export default fixedValue;