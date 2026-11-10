import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

export type SoundId = "classic" | "chime" | "siren" | "pulse" | "gentle" | "alert";
export type AlertStyle = "sound" | "vibrate" | "both";
export type AlarmSound = { style: AlertStyle; sound: SoundId; repeat_minutes?: number; snooze_minutes?: number };

export const SOUNDS: { id: SoundId; label: string; file: number }[] = [
  { id: "classic", label: "Classic beep", file: require("../assets/sounds/classic.wav") },
  { id: "siren", label: "Siren", file: require("../assets/sounds/siren.wav") },
  { id: "alert", label: "Alert", file: require("../assets/sounds/alert.wav") },
  { id: "pulse", label: "Pulse", file: require("../assets/sounds/pulse.wav") },
  { id: "chime", label: "Chime", file: require("../assets/sounds/chime.wav") },
  { id: "gentle", label: "Gentle", file: require("../assets/sounds/gentle.wav") },
];

let player: AudioPlayer | null = null;
let modeSet = false;

export async function playSound(id: SoundId) {
  if (!modeSet) {
    modeSet = true;
    // Alarms must be heard even with the silent switch on.
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }
  stopSound();
  const s = SOUNDS.find((x) => x.id === id) ?? SOUNDS[0];
  player = createAudioPlayer(s.file);
  player.play();
}

export function stopSound() {
  if (player) {
    player.pause();
    player.remove();
    player = null;
  }
}
