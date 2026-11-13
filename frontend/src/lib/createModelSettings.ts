
import type { StudioModel } from "./../api";
import type Settings from "./../types/Settings";

export default function createModelSettings(
  model: StudioModel,
  previous: Settings
): Settings {
  const presetName = model.presets.balanced
    ? "balanced"
    : Object.keys(model.presets)[0];

  const preset = model.presets[presetName];

  if (!preset) {
    return { ...previous, modelId: model.model_id };
  }

  const options = model.generation_options;

  return {
    ...previous,
    modelId: model.model_id,
    preset: presetName,
    resolution: `${preset.width}x${preset.height}`,
    steps: preset.steps,
    cfgScale: Number(
      options?.cfg_scale?.default ?? preset.cfg_scale
    ),
    negativePrompt: "",
    samplingMethod:
      options?.sampling_method?.default == null
        ? null
        : String(options.sampling_method.default),
    scheduler:
      options?.scheduler?.default == null
        ? null
        : String(options.scheduler.default),
  };
}
