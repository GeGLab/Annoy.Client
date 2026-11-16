import { t as translate } from "../../../../shared/localization/index.ts";
import { EQ_BANDS, EQ_LIMIT, MIXER_PRESETS, PREAMP_MAX, PREAMP_MIN, type MixerPreset } from "../../../../shared/sound-mixer.ts";
import { Icon } from "../../components/ui.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog.tsx";
import { Slider } from "../../components/ui/slider.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import { choosePreset, setMixer, useMixer, useMixerReach } from "./sound-studio.ts";

type Key = Parameters<typeof translate>[0];
const presetLabel = (preset: MixerPreset) => translate(`studio.preset.${preset}` as Key);
const band = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);
const bandShort = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

/**
 * The listener's equalizer in a song room: how the music sounds to them, on this device only.
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
  const db = (value: number) => `${value > 0 ? "+" : ""}${value} dB`;
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
        {/* The preamp first, apart: lower it when boosting a lot. */}
        <div className="studio-band preamp">
          <output>{db(mixer.preamp)}</output>
          <Slider orientation="vertical" min={PREAMP_MIN} max={PREAMP_MAX} step={0.5} value={mixer.preamp} aria-label={translate("studio.preamp")} aria-valuetext={db(mixer.preamp)} onChange={(e) => custom({ preamp: Number(e.target.value) })} />
          <span>{translate("studio.preampShort")}</span>
        </div>
        <div className="studio-bands" role="group" aria-label={translate("studio.bands")}>
          {EQ_BANDS.map((hz, i) => (
            <div key={hz} className="studio-band">
              <output>{db(mixer.eq[i] ?? 0)}</output>
              <Slider
                orientation="vertical" min={-EQ_LIMIT} max={EQ_LIMIT} step={0.5} value={mixer.eq[i] ?? 0}
                aria-label={translate("studio.band", { p0: band(hz) })}
                aria-valuetext={db(mixer.eq[i] ?? 0)}
                onChange={(e) => custom({ eq: mixer.eq.map((gain, j) => (j === i ? Number(e.target.value) : gain)) })}
              />
              <span>{bandShort(hz)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="studio-actions">
        <button type="button" className="studio-chip" onClick={() => choosePreset("flat")}>{translate("studio.reset")}</button>
      </div>
    </div>
  );
}
