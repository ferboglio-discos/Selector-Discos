const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/clima', async (req, res) => {
  const city = req.query.city || 'Buenos Aires';
  console.log('Buscando clima para:', city);
  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es&format=json`);
    const geoData = await geoRes.json();
    console.log('Geo respuesta:', JSON.stringify(geoData));
    if (!geoData.results?.length) return res.status(404).json({ error: 'Ciudad no encontrada' });
    const { latitude, longitude, name } = geoData.results[0];
    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto`);
    const wData = await wRes.json();
    console.log('Clima respuesta:', JSON.stringify(wData.current));
    const cur = wData.current;
    const temp = Math.round(cur.temperature_2m);
    const wc = cur.weather_code;
    let desc, emoji;
    if (wc === 0) { desc = 'Despejado'; emoji = '☀️'; }
    else if (wc <= 3) { desc = 'Parcialmente nublado'; emoji = '⛅'; }
    else if (wc <= 48) { desc = 'Nublado'; emoji = '☁️'; }
    else if (wc <= 67) { desc = 'Lluvia'; emoji = '🌧️'; }
    else if (wc <= 77) { desc = 'Nieve'; emoji = '🌨️'; }
    else { desc = 'Tormenta'; emoji = '⛈️'; }
    res.json({ temp, desc, emoji, humidity: cur.relative_humidity_2m, wind: Math.round(cur.wind_speed_10m), city: name });
  } catch (err) {
    console.log('Error clima:', err.message);
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
