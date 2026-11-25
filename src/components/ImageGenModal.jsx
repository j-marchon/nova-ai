import React, { useEffect, useState } from "react";
import { AlertCircle, Download, Image as ImageIcon, MessageSquare, RefreshCw, Sparkles, Wallpaper } from "lucide-react";
import { AccBtn, Button, Field, Modal, Skeleton, TextArea, TextInput, inputCls } from "./ui.jsx";
import {
  ASPECT_RATIOS,
  DEFAULT_NEGATIVE_PROMPT,
  generateImage,
  imageChoices,
  resolveDimensions,
  resolveImageBackend,
} from "../lib/imageGen.js";
import { saveFile } from "../lib/cards.js";
import { showToast } from "../lib/toast.js";
import { startActivity, useActivityFocus } from "../lib/activity.js";

const ASPECT_OPTIONS = ASPECT_RATIOS.map((r) => ({
  id: r.id,
  label: r.label,
}));

export function ImageGenModal({
  open,
  onClose,
  initialPrompt = "",
  initialNegativePrompt,
  settings,
  onSendToChat,
  onSetBackdrop,
  onSaveSettings,
}) {
  const savedConfig = settings?.imageGen || {};

  const [prompt, setPrompt] = useState(initialPrompt);
  const [negativePrompt, setNegativePrompt] = useState(
    initialNegativePrompt ?? savedConfig.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT
  );
  const choices = imageChoices(settings);
  /* a fresh setup with the Bridge or an OpenAI key saved starts there */
  const [provider, setProvider] = useState(() => savedConfig.provider && savedConfig.provider !== "ai_horde"
    ? savedConfig.provider
    : choices[0]?.id || "ai_horde");
  const [aspectRatio, setAspectRatio] = useState(savedConfig.aspectRatio || "portrait");
  const [apiKey, setApiKey] = useState(savedConfig.apiKey || "");
  const [endpoint, setEndpoint] = useState(savedConfig.endpoint || "");
  const [model, setModel] = useState(savedConfig.model || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [activityId, setActivityId] = useState(null);
  useActivityFocus(activityId, open);

  useEffect(() => {
    if (open) {
      if (initialPrompt) setPrompt(initialPrompt);
      if (initialNegativePrompt) setNegativePrompt(initialNegativePrompt);
      setError(null);
    }
  }, [open, initialPrompt, initialNegativePrompt]);

  if (!open) return null;

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);
    const job = startActivity({ kind: "image", label: "Image generation", model, quiet: true });
    setActivityId(job.id);

    try {
      const dims = resolveDimensions(aspectRatio);

      const backend = resolveImageBackend(settings, { provider, apiKey, endpoint, model });
      if (!backend) throw new Error(provider.startsWith("saved:")
        ? "That provider is gone or has no key. Pick another, or set it up in Settings → Model."
        : "Add an OpenAI key, or pick another provider.");

      const result = await generateImage({
        activity: job,
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        ...backend,
        width: dims.width,
        height: dims.height,
      });

      setGeneratedImage(result);
      job.done();

      if (onSaveSettings) {
        onSaveSettings({
          provider,
          aspectRatio,
          negativePrompt: negativePrompt.trim(),
          apiKey: apiKey.trim(),
          endpoint: endpoint.trim(),
          model: model.trim(),
        });
      }
    } catch (err) {
      job.fail(err);
      setError(err?.message || "Image generation failed. Please check parameters and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveImage = async () => {
    if (!generatedImage) return;
    try {
      const response = await fetch(generatedImage);
      if (!response.ok) throw new Error(`Image download failed (${response.status})`);
      const blob = await response.blob();
      const type = blob.type || "image/png";
      const ext = type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      const where = await saveFile(`nova-scene-${Date.now()}.${ext}`, new Uint8Array(await blob.arrayBuffer()), type);
      showToast(`Saved to ${where}`);
    } catch (e) {
      console.error("Save image failed", e);
      showToast("Could not save the image.", { tone: "warn" });
    }
  };

  return (
    <Modal title="Visualize Scene" onClose={onClose} wide>
      <div className="space-y-4">
        {/* Provider selection: saved providers (their keys reused), then services */}
        <Field label="Provider">
          <select
            value={provider}
            onChange={(e) => { setProvider(e.target.value); setError(null); }}
            className={inputCls + " cursor-pointer"}
          >
            {provider === "openai" && <option value="openai">OpenAI (key below)</option>}
            {!choices.some((c) => c.id === provider) && provider !== "openai" && <option value={provider}>Removed provider</option>}
            {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">
            {choices.find((c) => c.id === provider)?.sub || "Pick where pictures are made."}
            {!choices.some((c) => c.id.startsWith("saved:")) && " Add Nova Bridge (ChatGPT) or an OpenAI key in Settings → Model to use them here."}
          </p>
        </Field>

        {/* Aspect Ratio */}
        <Field label="Aspect Ratio">
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            className={inputCls}
          >
            {ASPECT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>

        <Field label="Model (optional)"><TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider.startsWith("saved:") ? "Leave empty for the default" : "Backend model or ComfyUI checkpoint filename"} /></Field>
        {/* Prompt Field */}
        <Field label="Scene Visual Prompt">
          <TextArea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the character, atmosphere, and surroundings..."
            className="text-sm"
          />
        </Field>

        {/* Negative Prompt Field */}
        <Field label="Negative prompt">
          <TextInput
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="Negative prompt / elements to avoid..."
            className="text-xs"
          />
        </Field>

        {/* Provider Specific Options */}
        {provider === "openai" && (
          <Field label="OpenAI API Key (optional if configured in Settings)">
            <TextInput
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="text-xs"
            />
          </Field>
        )}

        {(provider === "sd_webui" || provider === "comfyui") && (
          <Field
            label={
              provider === "sd_webui"
                ? "AUTOMATIC1111 / SD.Next API URL"
                : "ComfyUI API URL"
            }
          >
            <TextInput
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={
                provider === "sd_webui"
                  ? "http://127.0.0.1:7860"
                  : "http://127.0.0.1:8188"
              }
              className="text-xs"
            />
          </Field>
        )}

        {/* Error notification */}
        {error && (
          <div role="alert" className="nv-fade p-3 rounded-2xl bg-zinc-900 border border-[var(--nv-edge-ink)] text-zinc-100 text-xs flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-zinc-100" />
            <div className="flex-1 leading-relaxed">{error}</div>
          </div>
        )}

        {/* Generate Button */}
        <div>
          <AccBtn
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            size="lg"
            className="w-full"
            icon={loading ? undefined : Sparkles}
          >
            {loading && <RefreshCw className="nv-spin nv-btn-icon" aria-hidden="true" />}
            {loading ? "Generating scene art..." : "Generate Art"}
          </AccBtn>
        </div>

        {/* where the picture will appear, while it is being made */}
        {loading && !generatedImage && (
          <div className="mt-4 pt-4 border-t border-[var(--nv-line)]" aria-busy="true" aria-label="Generating">
            <Skeleton className="w-full h-56 rounded-2xl" />
          </div>
        )}

        {/* Generated Image Preview & Actions */}
        {generatedImage && (
          <div className="nv-media-entry mt-4 pt-4 border-t border-[var(--nv-line)] space-y-3">
            <p className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
              <ImageIcon size={14} className="text-[var(--acc)]" />
              Generated scene artwork
            </p>

            <div className="relative rounded-2xl overflow-hidden border border-[var(--nv-edge-ink)] bg-[var(--nv-control)] flex items-center justify-center p-2 min-h-48">
              <img
                src={generatedImage}
                alt="Generated scene"
                className="max-h-72 w-full object-contain rounded-xl"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button
                type="button"
                icon={MessageSquare}
                onClick={() => {
                  onSendToChat?.(generatedImage, prompt);
                  onClose();
                }}
                className="text-xs"
              >
                Send to Chat
              </Button>

              <Button
                type="button"
                icon={Wallpaper}
                onClick={() => {
                  onSetBackdrop?.(generatedImage);
                  onClose();
                }}
                className="text-xs"
              >
                Set as backdrop
              </Button>

              <Button
                type="button"
                icon={Download}
                onClick={handleSaveImage}
                className="text-xs"
              >
                Save image
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
