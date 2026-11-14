import { useState, type FormEvent } from 'react';
import { COORDINATE_PRESETS, isValidCoordinates, useCoordinates, type Coordinates } from '../coordinates.js';

export function CoordinateSelector(): JSX.Element {
  const { coordinates } = useCoordinates();
  // Remonter le formulaire à chaque changement de coordonnées évite un effet
  // de synchronisation prop → state (et ses rendus en cascade).
  return (
    <CoordinateForm
      key={`${coordinates.latitude}:${coordinates.longitude}`}
      coordinates={coordinates}
    />
  );
}

function CoordinateForm({ coordinates }: { coordinates: Coordinates }): JSX.Element {
  const { setCoordinates } = useCoordinates();
  const [latitude, setLatitude] = useState(String(coordinates.latitude));
  const [longitude, setLongitude] = useState(String(coordinates.longitude));
  const [error, setError] = useState<string | null>(null);

  const activePreset =
    COORDINATE_PRESETS.find(
      (preset) =>
        Math.abs(preset.latitude - coordinates.latitude) < 1e-6 &&
        Math.abs(preset.longitude - coordinates.longitude) < 1e-6,
    )?.name ?? 'custom';

  function applyPreset(name: string): void {
    const preset = COORDINATE_PRESETS.find((item) => item.name === name);
    if (!preset) return;
    setError(null);
    setCoordinates({ latitude: preset.latitude, longitude: preset.longitude });
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsedLatitude = Number(latitude.replace(',', '.'));
    const parsedLongitude = Number(longitude.replace(',', '.'));
    if (!isValidCoordinates(parsedLatitude, parsedLongitude)) {
      setError('Latitude attendue entre -90 et 90, longitude entre -180 et 180.');
      return;
    }
    setError(null);
    setCoordinates({ latitude: parsedLatitude, longitude: parsedLongitude });
  }

  return (
    <form className="coordinate-form" onSubmit={submit} aria-label="Sélection des coordonnées">
      <div className="field">
        <label htmlFor="preset-location">Lieu</label>
        <select id="preset-location" value={activePreset} onChange={(event) => applyPreset(event.target.value)}>
          {COORDINATE_PRESETS.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
          <option value="custom">Coordonnées personnalisées</option>
        </select>
      </div>

      <div className="field field-narrow">
        <label htmlFor="latitude">Latitude</label>
        <input
          id="latitude"
          name="latitude"
          type="number"
          step="0.0001"
          min={-90}
          max={90}
          inputMode="decimal"
          value={latitude}
          onChange={(event) => setLatitude(event.target.value)}
        />
      </div>

      <div className="field field-narrow">
        <label htmlFor="longitude">Longitude</label>
        <input
          id="longitude"
          name="longitude"
          type="number"
          step="0.0001"
          min={-180}
          max={180}
          inputMode="decimal"
          value={longitude}
          onChange={(event) => setLongitude(event.target.value)}
        />
      </div>

      <button type="submit" className="button button-secondary">
        Appliquer
      </button>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
