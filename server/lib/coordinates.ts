/**
 * Précision canonique des coordonnées (~11 m à l'équateur).
 *
 * Les clés de cache et les requêtes envoyées à Open-Meteo doivent utiliser la
 * même valeur : sans cela, deux points arrondis identiques partagent une entrée
 * de cache alors que la requête amont a été faite avec une autre précision, et
 * la réponse renvoyée porte les coordonnées du premier demandeur.
 */
export const CACHE_COORDINATE_DECIMALS = 4;

export function roundCoordinate(value: number): number {
  const rounded = Number(value.toFixed(CACHE_COORDINATE_DECIMALS));
  // Normalise -0 en 0 pour que la clé de cache soit stable.
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function roundCoordinates(
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number } {
  return {
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
  };
}
