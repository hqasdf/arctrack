import assert from "node:assert/strict";
import test from "node:test";
import { WEATHER_REFRESH_MS, approximateLocation, canCollectWeather, compassDirection, conditionDescription, isWeatherDistance, parseOpenMeteo, weatherToday } from "../src/weather-model.ts";

const now = Date.parse("2026-10-16T10:00:00Z");
const eligible = { distance: 70, sessionDate: "2026-10-16", plannedEnds: 2, arrowsPerEnd: 2, arrows: [] };

test("weather distance accepts positive whole metres except 18 without coercing junk", () => {
  for (const value of [1, 50, 70, 32767, "70", " 50 "]) assert.equal(isWeatherDistance(value), true);
  for (const value of [18, "18", 0, -1, 1.2, 32768, NaN, Infinity, null, true, "", " ", "70m", "7e1", "1.2", {}, []]) assert.equal(isWeatherDistance(value), false);
});

test("weather guard uses Singapore date and actual unique planned Arrow slots", () => {
  assert.equal(weatherToday(Date.parse("2026-10-15T16:00:00Z")), "2026-10-16");
  assert.equal(weatherToday(Date.parse("2026-10-15T15:59:59Z")), "2026-10-15");
  assert.equal(canCollectWeather(eligible, now), true);
  assert.equal(canCollectWeather({ ...eligible, distance: 18 }, now), false);
  assert.equal(canCollectWeather({ ...eligible, sessionDate: "2026-10-15" }, now), false);
  const full = [{ end: 1, arrow: 1 }, { end: 1, arrow: 2 }, { end: 2, arrow: 1 }, { end: 2, arrow: 2 }];
  assert.equal(canCollectWeather({ ...eligible, arrows: full }, now), false);
  assert.equal(canCollectWeather({ ...eligible, arrows: [full[0], full[0], full[1], { end: 99, arrow: 1 }] }, now), true);
  assert.equal(canCollectWeather({ ...eligible, arrowsPerEnd: 0 }, now), false);
});

test("approximate location is rounded before transmission and invalid coordinates rejected", () => {
  assert.deepEqual(approximateLocation(1.35217, 103.81987), { latitude: 1.35, longitude: 103.82 });
  for (const args of [[91, 0], [0, -181], [NaN, 0], [0, Infinity]]) assert.throws(() => approximateLocation(...args));
});

function provider() {
  return { current: { time: now / 1000, temperature_2m: 0, wind_speed_10m: 0, wind_gusts_10m: null, wind_direction_10m: 0, relative_humidity_2m: 0, weather_code: 0 },
    current_units: { time: "unixtime", temperature_2m: "\u00b0C", wind_speed_10m: "km/h", wind_gusts_10m: "km/h", wind_direction_10m: "\u00b0", relative_humidity_2m: "%", weather_code: "wmo code" } };
}

test("provider normalization preserves zero, missing metrics and observation time", () => {
  assert.deepEqual(parseOpenMeteo(provider(), now), { observedAt: "2026-10-16T10:00:00.000Z", temperatureC: 0, windSpeedKph: 0, windGustKph: null, windDirectionDegrees: 0, humidityPercent: 0, conditionCode: 0 });
  const missing = provider(); delete missing.current.temperature_2m;
  assert.equal(parseOpenMeteo(missing, now).temperatureC, null);
  assert.equal(WEATHER_REFRESH_MS, 1_800_000);
});

test("provider rejects incorrect units, malformed measurements and stale/future observations", () => {
  const invalid = [];
  let value = provider(); value.current_units.wind_speed_10m = "m/s"; invalid.push(value);
  value = provider(); value.current.relative_humidity_2m = 101; invalid.push(value);
  value = provider(); value.current.wind_speed_10m = "12"; invalid.push(value);
  value = provider(); value.current.weather_code = 4; invalid.push(value);
  value = provider(); value.current.time += 3600; invalid.push(value);
  value = provider(); value.current.time -= 7 * 3600; invalid.push(value);
  for (const input of [null, {}, ...invalid]) assert.throws(() => parseOpenMeteo(input, now));
});

test("weather presentation retains compass and condition meaning", () => {
  assert.equal(compassDirection(0), "N"); assert.equal(compassDirection(360), "N");
  assert.equal(compassDirection(45), "NE"); assert.equal(compassDirection(180), "S");
  assert.equal(conditionDescription(2), "Partly cloudy"); assert.equal(conditionDescription(95), "Thunderstorm");
  assert.equal(conditionDescription(null), "Conditions unavailable");
});
