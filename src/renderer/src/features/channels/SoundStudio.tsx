import { t as translate } from "../../../../shared/localization/index.ts";
import { EQ_BANDS, EQ_LIMIT, MIXER_PRESETS, type MixerPreset } from "../../../../shared/sound-mixer.ts";
import { Icon } from "../../components/ui.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog.tsx";
import { Slider } from "../../components/ui/slider.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { choosePreset, setMixer, useMixer, useMixerReach } from "./sound-studio.ts";

type Key = Parameters<typeof translate>[0];
const presetLabel = (preset: MixerPreset) => translate(`studio.preset.${preset}` as Key);
const band = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);

/**
 * The listener's mixer in a song room: how the music sounds to them, on this device only.
 */
export function SoundStudio({ onClose, effectsHere }: { onClose: () => void; effectsHere: boolean }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="modal glass-dialog sound-studio" overlayClassName="glass-overlay" aria-describedby="sound-studio-note">
        <div className="modal-body">
          <DialogTitle asChild><h2><Icon name="sliders" size={20} /> {translate("studio.title")}</h2></DialogTitle>
          <DialogDescription id="sound-studio-note" className="muted small">{translate("studio.onlyYou")}</DialogDescription>
          <MixerPanel effectsHere={effectsHere} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MixerPanel({ effectsHere }: { effectsHere: boolean }) {
  const mixer = useMixer();
  const reach = useMixerReach();
  const custom = (patch: Partial<typeof mixer>) => setMixer({ ...mixer, ...patch, on: true, preset: "custom" });
  return (
    <div className="studio-mixer">
      <label className="switch-setting">
        <span><strong>{translate("studio.mixerOn")}</strong><small>{translate("studio.mixerHint")}</small></span>
        <Switch aria-label={translate("studio.mixerOn")} checked={mixer.on} onCheckedChange={(on) => setMixer({ ...mixer, on })} />
      </label>
      {!effectsHere ? (
        <p className="studio-note" role="status"><Icon name="info" size={14} /> {translate("studio.notThisTrack")}</p>
      ) : mixer.on && reach === false ? (
        <p className="studio-note" role="status"><Icon name="info" size={14} /> {translate("studio.cannotRead")}</p>
      ) : null}
      <div className="studio-presets" role="group" aria-label={translate("studio.presets")}>
        {MIXER_PRESETS.map((preset) => (
          <button key={preset} type="button" className={`studio-chip${mixer.on && mixer.preset === preset ? " active" : ""}`} aria-pressed={mixer.on && mixer.preset === preset} onClick={() => choosePreset(preset)}>
            {presetLabel(preset)}
          </button>
        ))}
      </div>
      <div className={`studio-eq${mixer.on ? "" : " off"}`}>
        {EQ_BANDS.map((hz, i) => (
          <label key={hz} className="studio-slider">
            <span>{band(hz)}</span>
            <Slider
              min={-EQ_LIMIT} max={EQ_LIMIT} step={0.5} value={mixer.eq[i] ?? 0}
              aria-label={translate("studio.band", { p0: band(hz) })}
              aria-valuetext={`${mixer.eq[i] ?? 0} dB`}
              onChange={(e) => custom({ eq: mixer.eq.map((gain, j) => (j === i ? Number(e.target.value) : gain)) })}
            />
            <output>{(mixer.eq[i] ?? 0) > 0 ? "+" : ""}{mixer.eq[i] ?? 0} dB</output>
          </label>
        ))}
        <label className="studio-slider">
          <span>{translate("studio.reverb")}</span>
          <Slider min={0} max={100} value={Math.round(mixer.reverb * 100)} aria-label={translate("studio.reverb")} aria-valuetext={`${Math.round(mixer.reverb * 100)}%`} onChange={(e) => custom({ reverb: Number(e.target.value) / 100 })} />
          <output>{Math.round(mixer.reverb * 100)}%</output>
        </label>
        <label className="studio-slider">
          <span>{translate("studio.spin")}</span>
          <Slider min={0} max={100} value={Math.round(mixer.spin * 100)} aria-label={translate("studio.spin")} aria-valuetext={`${Math.round(mixer.spin * 100)}%`} onChange={(e) => custom({ spin: Number(e.target.value) / 100 })} />
          <output>{Math.round(mixer.spin * 100)}%</output>
        </label>
      </div>
    </div>
  );
}
