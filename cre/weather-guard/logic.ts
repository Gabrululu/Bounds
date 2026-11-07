// Pure decision logic and encoding. No capability calls here, so it runs the same on every node.
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex, toBytes, type Hex } from "viem"

export type WeatherLimits = { windKmh: number; rainMmPerHour: number }
export type WeatherReading = { windKmh: number; rainMmPerHour: number }
export type Zone = { name: string; latitude: number; longitude: number }

export const REASON_WIND = "WEATHER_WIND_LIMIT"
export const REASON_RAIN = "WEATHER_RAIN_LIMIT"
export const SOURCE = "open-meteo"

export const labelhash = (label: string): Hex => keccak256(toBytes(label))
export const zoneId = (name: string): Hex => keccak256(toBytes(name))
export const toBytes32Text = (text: string): Hex => stringToHex(text, { size: 32 })

/** Returns the reason a zone is unsafe, or null. Wind wins when both limits are reached. */
export const unsafeReason = (reading: WeatherReading, limits: WeatherLimits): string | null => {
  if (reading.windKmh >= limits.windKmh) return REASON_WIND
  if (reading.rainMmPerHour >= limits.rainMmPerHour) return REASON_RAIN
  return null
}

/** An HTTP caller can only tighten the configured limits, never relax them. */
export const stricterLimits = (base: WeatherLimits, requested: Partial<WeatherLimits>): WeatherLimits => ({
  windKmh: Math.min(base.windKmh, requested.windKmh ?? Infinity),
  rainMmPerHour: Math.min(base.rainMmPerHour, requested.rainMmPerHour ?? Infinity),
})

/** Same layout that BoundsCREConsumer.onReport decodes. */
export const encodeRevocation = (label: string, reason: string, source: string = SOURCE): Hex =>
  encodeAbiParameters(parseAbiParameters("bytes32 labelhash, bytes32 reasonCode, bytes32 source"), [
    labelhash(label),
    toBytes32Text(reason),
    toBytes32Text(source),
  ])

/** Parses an Open-Meteo `current` response. Throws rather than guess when a value is missing. */
export const parseWeather = (body: string): WeatherReading => {
  const current = (JSON.parse(body) as { current?: { wind_speed_10m?: unknown; precipitation?: unknown } }).current
  const windKmh = current?.wind_speed_10m
  const rainMmPerHour = current?.precipitation
  if (typeof windKmh !== "number" || !Number.isFinite(windKmh)) throw new Error("Weather response has no wind speed")
  if (typeof rainMmPerHour !== "number" || !Number.isFinite(rainMmPerHour)) {
    throw new Error("Weather response has no precipitation")
  }
  return { windKmh, rainMmPerHour }
}

export const weatherUrl = (baseUrl: string, zone: Zone): string =>
  `${baseUrl}?latitude=${zone.latitude}&longitude=${zone.longitude}` +
  "&current=wind_speed_10m,precipitation&wind_speed_unit=kmh&precipitation_unit=mm"
