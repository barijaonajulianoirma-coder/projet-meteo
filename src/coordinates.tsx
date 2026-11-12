import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface CoordinatePreset extends Coordinates {
  name: string;
}

export const COORDINATE_PRESETS: CoordinatePreset[] = [
  { name: 'Antananarivo', latitude: -18.8792, longitude: 47.5079 },
  { name: 'Toamasina', latitude: -18.1492, longitude: 49.4023 },
  { name: 'Fianarantsoa', latitude: -21.4527, longitude: 47.0857 },
  { name: 'Antsiranana', latitude: -12.2795, longitude: 49.2913 },
  { name: 'Toliara', latitude: -23.3568, longitude: 43.6662 },
];

const STORAGE_KEY = 'meteo-analyse:coordinates';

export function isValidCoordinates(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function readStored(): Coordinates {
  const fallback = COORDINATE_PRESETS[0]!;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { latitude: fallback.latitude, longitude: fallback.longitude };
    const parsed = JSON.parse(raw) as Partial<Coordinates>;
    if (
      typeof parsed.latitude === 'number' &&
      typeof parsed.longitude === 'number' &&
      isValidCoordinates(parsed.latitude, parsed.longitude)
    ) {
      return { latitude: parsed.latitude, longitude: parsed.longitude };
    }
  } catch {
    // Stockage indisponible : on garde les coordonnées par défaut.
  }
  return { latitude: fallback.latitude, longitude: fallback.longitude };
}

interface CoordinatesContextValue {
  coordinates: Coordinates;
  setCoordinates: (next: Coordinates) => void;
}

const CoordinatesContext = createContext<CoordinatesContextValue | null>(null);

export function CoordinatesProvider({ children }: { children: ReactNode }): JSX.Element {
  const [coordinates, setCoordinatesState] = useState<Coordinates>(() => readStored());

  const setCoordinates = useCallback((next: Coordinates) => {
    if (!isValidCoordinates(next.latitude, next.longitude)) return;
    setCoordinatesState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Le stockage local n'est pas indispensable : l'état reste en mémoire.
    }
  }, []);

  const value = useMemo(() => ({ coordinates, setCoordinates }), [coordinates, setCoordinates]);

  return <CoordinatesContext.Provider value={value}>{children}</CoordinatesContext.Provider>;
}

export function useCoordinates(): CoordinatesContextValue {
  const context = useContext(CoordinatesContext);
  if (!context) throw new Error('useCoordinates doit être utilisé dans CoordinatesProvider');
  return context;
}
