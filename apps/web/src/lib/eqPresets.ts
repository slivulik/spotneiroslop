/** Built-in equaliser presets (dB for 31 Hz … 16 kHz). Same names and curves as on Android. */
export const EQ_PRESETS: { id: string; name: string; bands: number[] }[] = [
  { id: "flat", name: "Ровно", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "bass", name: "Больше баса", bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: "treble", name: "Больше верхов", bands: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  { id: "vocal", name: "Голос", bands: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  { id: "loudness", name: "Громкость", bands: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5] },
  { id: "rock", name: "Рок", bands: [5, 4, 2, -1, -2, -1, 2, 3, 4, 4] },
  { id: "pop", name: "Поп", bands: [-1, 0, 2, 3, 4, 3, 1, 0, -1, -1] },
  { id: "jazz", name: "Джаз", bands: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { id: "electronic", name: "Электроника", bands: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5] },
  { id: "hiphop", name: "Хип-хоп", bands: [6, 5, 2, 3, -1, -1, 1, -1, 2, 3] },
  { id: "classical", name: "Классика", bands: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  { id: "acoustic", name: "Акустика", bands: [4, 3, 2, 1, 1, 1, 2, 3, 2, 1] },
];
