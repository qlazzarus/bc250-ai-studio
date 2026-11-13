type Settings = {
  modelId: string; prompt: string; negativePrompt: string; preset: string;
  resolution: string; steps: number; cfgScale: number; samplingMethod: string | null;
  scheduler: string | null; seed: string; batchCount: number;
};

export default Settings;