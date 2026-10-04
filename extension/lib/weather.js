// Hava durumu (Open-Meteo — anahtarsız, ücretsiz). DJ'lerin "İstanbul'da hava 18 derece" demesi için.

const CODES = {
  0: 'açık', 1: 'çoğunlukla açık', 2: 'parçalı bulutlu', 3: 'kapalı',
  45: 'sisli', 48: 'kırağılı sis', 51: 'hafif çiseleyen', 53: 'çiseleyen', 55: 'yoğun çiseleyen',
  61: 'hafif yağmurlu', 63: 'yağmurlu', 65: 'sağanak yağmurlu', 66: 'dondurucu yağmurlu', 67: 'dondurucu sağanaklı',
  71: 'hafif karlı', 73: 'karlı', 75: 'yoğun karlı', 77: 'kar taneli', 80: 'hafif sağanaklı', 81: 'sağanaklı', 82: 'şiddetli sağanaklı',
  85: 'kar sağanaklı', 86: 'yoğun kar sağanaklı', 95: 'gök gürültülü fırtınalı', 96: 'dolu ihtimalli fırtınalı', 99: 'dolulu fırtınalı',
};

let cache = { key: '', at: 0, text: null };

export function describeWeather(city, cur) {
  if (!cur) return null;
  const t = Math.round(cur.temperature_2m);
  const desc = CODES[cur.weather_code] || 'değişken';
  const wind = Math.round(cur.wind_speed_10m || 0);
  return `${city}: ${t} derece, ${desc}${wind >= 25 ? `, rüzgâr saatte ${wind} km` : ''}`;
}

export async function getWeather(city, fetchImpl = fetch) {
  if (!city) return null;
  const key = city.toLocaleLowerCase('tr-TR');
  if (cache.key === key && Date.now() - cache.at < 30 * 60e3) return cache.text;
  try {
    const g = await (await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=tr&name=${encodeURIComponent(city)}`)).json();
    const loc = g?.results?.[0];
    if (!loc) return null;
    const w = await (await fetchImpl(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`)).json();
    const text = describeWeather(loc.name || city, w?.current);
    cache = { key, at: Date.now(), text };
    return text;
  } catch {
    return cache.key === key ? cache.text : null;
  }
}
