import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { AccBtn, Field, Slider, ToggleRow, TextInput, inputCls } from "./ui.jsx";
import { OPENAI_VOICES, getVoices, isSpeaking, sourceOfVoice, speak, speechChoices, speechOptions, stopSpeech } from "../lib/tts.js";
import { DEFAULT_VOICE_SETTINGS } from "../lib/data.js";

export function VoiceSection({ voiceSettings, providers = [], onChange }) {
  const vs = { ...DEFAULT_VOICE_SETTINGS, ...(voiceSettings || {}) };
  const source = sourceOfVoice(vs);
  const choices = speechChoices(providers);
  const saved = source.startsWith("saved:");
  const hasBridge = providers.some((p) => p.preset === "nova-bridge");
  const [voices, setVoices] = useState(() => getVoices());
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const updateVoices = () => {
      setVoices(getVoices());
    };
    updateVoices();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.addEventListener?.("voiceschanged", updateVoices);
      window.speechSynthesis.onvoiceschanged = updateVoices;
      return () => {
        window.speechSynthesis.removeEventListener?.("voiceschanged", updateVoices);
      };
    }
  }, []);

  const handleTest = () => {
    if (testing || isSpeaking()) {
      stopSpeech();
      setTesting(false);
      return;
    }

    setTesting(true);
    const testSample = vs.dialogueOnly
      ? '"Greetings! I am ready to bring your adventures to life," said the narrator.'
      : '*Takes a deep breath and smiles warmly.* Greetings! I am ready to bring your adventures to life.';

    speak(testSample, {
      ...speechOptions(vs, providers),
      onStart: () => setTesting(true),
      onEnd: () => setTesting(false),
      onError: () => setTesting(false),
    });
  };

  return (
    <div className="space-y-3.5">
      <Field label="Voice from">
        <select
          value={choices.some((c) => c.id === source) ? source : ""}
          onChange={(e) => onChange({ ...vs, source: e.target.value, voice: "", model: "" })}
          className={inputCls + " cursor-pointer"}
        >
          {!choices.some((c) => c.id === source) && <option value="">Removed provider</option>}
          {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">
          {choices.find((c) => c.id === source)?.sub || "Pick where the voice comes from."}
          {!choices.some((c) => c.id.startsWith("saved:")) && " Add an OpenAI key in Settings → Providers for natural voices."}
          {hasBridge && " Nova Bridge can't read aloud: subscriptions have no speech API."}
        </p>
      </Field>
      {source === "custom" && <><Field label="Speech address"><TextInput value={vs.endpoint || ""} onChange={(e) => onChange({ ...vs, endpoint: e.target.value })} placeholder="https://…/v1/audio/speech" /></Field><Field label="API key"><TextInput type="password" value={vs.apiKey || ""} onChange={(e) => onChange({ ...vs, apiKey: e.target.value })} /></Field><Field label="Model"><TextInput value={vs.model || ""} onChange={(e) => onChange({ ...vs, model: e.target.value })} placeholder="tts-1" /></Field><Field label="Voice"><TextInput value={vs.voice || ""} onChange={(e) => onChange({ ...vs, voice: e.target.value })} placeholder="alloy" /></Field></>}
      {saved && <Field label="Voice">
        <select value={vs.voice || "alloy"} onChange={(e) => onChange({ ...vs, voice: e.target.value })} className={inputCls + " cursor-pointer"}>
          {OPENAI_VOICES.map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
        </select>
      </Field>}
      {source === "system" && <Field label="Voice">
        <select
          value={vs.voice || ""}
          onChange={(e) => onChange({ ...vs, voice: e.target.value })}
          className={inputCls + " cursor-pointer"}
        >
          <option value="">Default system voice</option>
          {voices.map((v) => (
            <option key={v.voiceURI || v.name} value={v.name}>
              {v.name} {v.lang ? `(${v.lang})` : ""}
            </option>
          ))}
        </select>
      </Field>}

      <Slider
        label="Speech rate"
        value={vs.rate ?? 1.0}
        min={0.5}
        max={2.0}
        step={0.1}
        onChange={(v) => onChange({ ...vs, rate: Math.round(v * 10) / 10 })}
        fmt={(v) => `${Number(v).toFixed(1)}x`}
      />

      {source === "system" && <Slider
        label="Speech pitch"
        value={vs.pitch ?? 1.0}
        min={0.5}
        max={2.0}
        step={0.1}
        onChange={(v) => onChange({ ...vs, pitch: Math.round(v * 10) / 10 })}
        fmt={(v) => `${Number(v).toFixed(1)}x`}
      />}

      <ToggleRow
        title="Dialogue only"
        sub="Skip narration"
        on={Boolean(vs.dialogueOnly)}
        onClick={() => onChange({ ...vs, dialogueOnly: !vs.dialogueOnly })}
      />

      <AccBtn
        type="button"
        onClick={handleTest}
        className="w-full"
        icon={testing ? VolumeX : Volume2}
      >
        {testing ? "Stop preview" : "Test voice"}
      </AccBtn>
    </div>
  );
}
