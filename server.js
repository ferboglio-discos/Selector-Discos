const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let spotifyToken = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;
  const creds = Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + creds, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  spotifyToken = data.access_token;
  spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyToken;
}

let climaCache = {};

app.get('/api/clima', async (req, res) => {
  const city = req.query.city || 'Buenos Aires';
  const ahora = Date.now();
  if (climaCache[city] && (ahora - climaCache[city].timestamp) < 30 * 60 * 1000) {
    return res.json(climaCache[city].data);
  }
  try {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
    const wRes = await fetch(url);
    const wData = await wRes.json();
    const cur = wData.current_condition[0];
    const temp = Math.round(parseFloat(cur.temp_C));
    const wind = Math.round(parseFloat(cur.windspeedKmph));
    const humidity = parseInt(cur.humidity);
    const desc = cur.lang_es?.[0]?.value || cur.weatherDesc?.[0]?.value || 'Despejado';
    const code = parseInt(cur.weatherCode);
    let emoji;
    if (code === 113) emoji = '☀️';
    else if ([116,119].includes(code)) emoji = '⛅';
    else if ([122,143,248,260].includes(code)) emoji = '☁️';
    else if ([176,180,182,185,263,266,281,284,293,296,299,302,305,308,311,314,317,320,323,326].includes(code)) emoji = '🌧️';
    else if ([227,230,329,332,335,338,350,368,371,374,377].includes(code)) emoji = '🌨️';
    else if ([200,386,389,392,395].includes(code)) emoji = '⛈️';
    else emoji = '🌡️';
    const resultado = { temp, desc, emoji, humidity, wind, city };
    climaCache[city] = { data: resultado, timestamp: ahora };
    res.json(resultado);
  } catch (err) {
    if (climaCache[city]) return res.json({ ...climaCache[city].data, cached: true });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/spotify/buscar', async (req, res) => {
  const { album, artist } = req.query;
  if (!album || !artist) return res.status(400).json({ error: 'Faltan parámetros' });
  try {
    const token = await getSpotifyToken();
    const query = encodeURIComponent('album:' + album + ' artist:' + artist);
    const r = await fetch('https://api.spotify.com/v1/search?q=' + query + '&type=album&limit=1&market=AR', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await r.json();
    if (!data.albums?.items?.length) {
      const query2 = encodeURIComponent(album + ' ' + artist);
      const r2 = await fetch('https://api.spotify.com/v1/search?q=' + query2 + '&type=album&limit=1&market=AR', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data2 = await r2.json();
      if (!data2.albums?.items?.length) return res.json({ found: false });
      const item = data2.albums.items[0];
      return res.json({ found: true, uri: item.uri, url: item.external_urls.spotify, name: item.name, artist: item.artists[0]?.name, image: item.images[1]?.url || item.images[0]?.url });
    }
    const item = data.albums.items[0];
    res.json({ found: true, uri: item.uri, url: item.external_urls.spotify, name: item.name, artist: item.artists[0]?.name, image: item.images[1]?.url || item.images[0]?.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recomendar', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Falta el prompt' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content.map(c => c.text || '').join('');
    res.json({ resultado: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
let historial = [];

app.post('/api/historial/agregar', (req, res) => {
  const { discos } = req.body;
  if (!discos || !Array.isArray(discos)) return res.status(400).json({ error: 'Faltan discos' });
  const fecha = new Date().toLocaleDateString('es-AR');
  historial.unshift({ fecha, discos, timestamp: Date.now() });
  if (historial.length > 20) historial = historial.slice(0, 20);
  res.json({ ok: true });
});

app.get('/api/historial', (req, res) => {
  res.json({ historial });
});

app.post('/api/historial/limpiar', (req, res) => {
  historial = [];
  res.json({ ok: true });
});

app.post('/api/spotify/recomendar', async (req, res) => {
  const { generos, decadas, mood, ocasion, efemeride } = req.body;
  try {
    const token = await getSpotifyToken();
    const resultados = [];
    const generosQuery = generos && generos.length ? generos.slice(0,2).join(' ') : 'rock';
    const decadaQuery = decadas && decadas.length ? decadas[Math.floor(Math.random()*decadas.length)] : '1970s';
    const queries = [
      generosQuery + ' ' + decadaQuery,
      efemeride ? efemeride.substring(0, 50) : generosQuery + ' classic',
      generosQuery + ' ' + (mood || 'relaxing')
    ];
    for (const q of queries) {
      const r = await fetch('https://api.spotify.com/v1/search?q='+encodeURIComponent(q)+'&type=album&limit=5&market=AR', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const d = await r.json();
      if (d.albums && d.albums.items.length) {
        const item = d.albums.items[Math.floor(Math.random()*Math.min(3,d.albums.items.length))];
        resultados.push({
          found: true,
          uri: item.uri,
          url: item.external_urls.spotify,
          name: item.name,
          artist: item.artists[0]?.name,
          image: item.images[1]?.url || item.images[0]?.url,
          query: q
        });
      }
    }
    res.json({ resultados });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
