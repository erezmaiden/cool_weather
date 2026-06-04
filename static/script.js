const el = id => document.getElementById(id)

const citySelect = el('city-name')
let appConfig = null

function populateCities(cities = {}) {
  citySelect.innerHTML = '<option value="" disabled selected>Choose a city</option>' +
    Object.keys(cities).map(name => `<option value="${name}">${name}</option>`).join('')
}

function guessCity(){
  const timezoneMap = appConfig?.timezoneToCity || {}
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if(timezoneMap[tz]){
      return timezoneMap[tz]
    }
  } catch {
    // ignore
  }
  try {
    const lang = navigator.language || navigator.userLanguage || ''
    if(lang.startsWith('he')){
      return 'Tel Aviv'
    }
  } catch {
    // ignore
  }
  return ''
}

function findCityByCoords(lat, lon){
  const threshold = 0.2
  const cities = appConfig?.cities || {}
  for(const [name, coords] of Object.entries(cities)){
    const [cityLat, cityLon] = coords.split(',').map(Number)
    if(Math.abs(cityLat - lat) < threshold && Math.abs(cityLon - lon) < threshold){
      return name
    }
  }
  return ''
}

function setMessage(text, type = 'info'){
  const msg = el('message')
  msg.textContent = text
  msg.className = type === 'error' ? 'message error' : 'message'
}

function locationErrorMessage(err){
  switch(err.code){
    case 1:
      return 'Location permission denied. Please select a city manually.'
    case 2:
      return 'Position update is unavailable. Please select a city manually.'
    case 3:
      return 'Location request timed out. Please select a city manually.'
    default:
      return err.message ? `Location error: ${err.message}. Please select a city manually.` : 'Unable to get location. Please select a city manually.'
  }
}

function clearMessage(){
  setMessage('')
}

async function fetchWeather(lat, lon){
  const base = appConfig?.weatherApiBase || 'https://api.open-meteo.com/v1/forecast'
  const params = appConfig?.weatherApiParams || 'current_weather=true&timezone=auto'
  const url = `${base}?latitude=${lat}&longitude=${lon}&${params}`
  const res = await fetch(url)
  if(!res.ok) throw new Error('Network error')
  return res.json()
}

async function fetchIpLocation(){
  const res = await fetch('/ip-location')
  if(!res.ok) throw new Error('IP location service unavailable')
  return res.json()
}

async function loadConfig(){
  const res = await fetch('/api/config')
  if(!res.ok) throw new Error('Configuration service unavailable')
  appConfig = await res.json()
  populateCities(appConfig.cities)
}

function show(data, lat, lon){
  const cw = data.current_weather || {}
  const matchedCity = findCityByCoords(lat, lon)
  el('result').hidden = false
  el('place').textContent = matchedCity ? `${matchedCity} (current location)` : `Coordinates: ${lat.toFixed(4)}, ${lon.toFixed(4)}`
  el('temp').textContent = cw.temperature ? `${cw.temperature} °C` : '—'
  el('wind').textContent = cw.windspeed ? `${cw.windspeed} m/s` : '—'
  el('weather').textContent = cw.weathercode ?? '—'
  el('time').textContent = cw.time ?? '—'
}

async function saveHistory(record){
  try{
    await fetch('/api/history', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(record)
    })
  }catch(e){
    console.warn('History save failed', e)
  }
}

async function loadHistory(){
  try{
    const res = await fetch('/api/history')
    if(!res.ok) throw new Error('History load failed')
    const data = await res.json()
    renderHistory(data.history || [])
  }catch(e){
    console.warn('Unable to load history', e)
  }
}

function renderHistory(history){
  const list = el('history-list')
  if(!history.length){
    list.innerHTML = '<li>No saved searches yet.</li>'
    return
  }
  list.innerHTML = history.map(item => {
    const cityLabel = item.city ? `${item.city} — ` : ''
    const timeLabel = item.observation_time ? ` at ${item.observation_time}` : ''
    return `<li class="history-item" data-lat="${item.latitude}" data-lon="${item.longitude}">${cityLabel}${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}${timeLabel}</li>`
  }).join('')
}

function clearHistory(){
  return fetch('/api/history', {method: 'DELETE'})
}

function currentFetchCity(lat, lon){
  const matched = findCityByCoords(lat, lon)
  return matched || citySelect.value || ''
}

async function performFetch(lat, lon){
  const data = await fetchWeather(lat, lon)
  show(data, lat, lon)
  const cw = data.current_weather || {}
  const record = {
    city: currentFetchCity(lat, lon),
    latitude: lat,
    longitude: lon,
    temperature: cw.temperature ?? null,
    windspeed: cw.windspeed ?? null,
    weathercode: cw.weathercode ?? null,
    observation_time: cw.time ?? null
  }
  await saveHistory(record)
  await loadHistory()
}

el('fetch').addEventListener('click', async ()=>{
  let lat = parseFloat(el('lat').value)
  let lon = parseFloat(el('lon').value)
  const city = citySelect.value
  if((!Number.isFinite(lat) || !Number.isFinite(lon)) && appConfig?.cities?.[city]){
    const coords = appConfig.cities[city].split(',').map(Number)
    lat = coords[0]
    lon = coords[1]
    el('lat').value = lat
    el('lon').value = lon
  }

  if(Number.isFinite(lat) && Number.isFinite(lon)){
    try{
      await performFetch(lat, lon)
      clearMessage()
    }catch(e){
      setMessage('Network error: ' + e.message, 'error')
    }
  }else{
    setMessage('Enter a valid city or latitude/longitude values.', 'error')
  }
})

el('locate').addEventListener('click', ()=>{
  if(!navigator.geolocation){
    setMessage('Geolocation is not supported by this browser.', 'error')
    return
  }
  const geoOptions = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 300000
  }

  navigator.geolocation.getCurrentPosition(async pos=>{
    const lat = pos.coords.latitude
    const lon = pos.coords.longitude
    el('lat').value = lat
    el('lon').value = lon
    const matchedCity = findCityByCoords(lat, lon)
    if(matchedCity){
      citySelect.value = matchedCity
      setMessage(`Using current location: ${matchedCity}`)
    } else {
      citySelect.value = ''
      setMessage('Using your current location. Choose a city if you want to switch.', 'info')
    }
    try{
      await performFetch(lat, lon)
      clearMessage()
    }catch(e){
      setMessage('Network error: ' + e.message, 'error')
    }
  }, async err=>{
    setMessage(`${locationErrorMessage(err)} Attempting approximate location by IP...`, 'info')
    try{
      const ipData = await fetchIpLocation()
      const lat = Number(ipData.latitude)
      const lon = Number(ipData.longitude)
      el('lat').value = lat
      el('lon').value = lon
      const matchedCity = findCityByCoords(lat, lon)
      if(matchedCity){
        citySelect.value = matchedCity
        setMessage(`Using approximate location: ${matchedCity}`)
      } else {
        citySelect.value = ''
        setMessage('Using approximate location. Choose a city if you want to switch.', 'info')
      }
      await performFetch(lat, lon)
      clearMessage()
      return
    }catch(ipErr){
      const city = citySelect.value
      if(appConfig?.cities?.[city]){
        const [lat, lon] = appConfig.cities[city].split(',').map(Number)
        el('lat').value = lat
        el('lon').value = lon
        setMessage(`Location unavailable: ${locationErrorMessage(err)} Using selected city ${city}.`, 'info')
        return
      }

      const guessed = guessCity()
      if(guessed && appConfig?.cities?.[guessed]){
        citySelect.value = guessed
        const [lat, lon] = appConfig.cities[guessed].split(',').map(Number)
        el('lat').value = lat
        el('lon').value = lon
        setMessage(`Location unavailable: ${locationErrorMessage(err)} Falling back to ${guessed}.`, 'info')
        return
      }

      setMessage(`${locationErrorMessage(err)} IP fallback failed. Please select a city manually.`, 'error')
    }
  }, geoOptions)
})

citySelect.addEventListener('change', ()=>{
  const city = citySelect.value
  if(appConfig?.cities?.[city]){
    const [lat, lon] = appConfig.cities[city].split(',').map(Number)
    el('lat').value = lat
    el('lon').value = lon
  }
})

document.addEventListener('click', event => {
  const historyItem = event.target.closest('.history-item')
  if(!historyItem) return
  const lat = Number(historyItem.dataset.lat)
  const lon = Number(historyItem.dataset.lon)
  if(Number.isFinite(lat) && Number.isFinite(lon)){
    el('lat').value = lat
    el('lon').value = lon
    performFetch(lat, lon).catch(e => setMessage('Network error: ' + e.message, 'error'))
  }
})

el('clear-history').addEventListener('click', async ()=>{
  try{
    const res = await clearHistory()
    if(!res.ok) throw new Error('Clear history failed')
    await loadHistory()
    setMessage('History cleared.', 'info')
  }catch(e){
    setMessage('Unable to clear history: ' + e.message, 'error')
  }
})

async function initializeApp(){
  try{
    await loadConfig()
    const initialCity = guessCity()
    if(initialCity && appConfig?.cities?.[initialCity]){
      citySelect.value = initialCity
      const [lat, lon] = appConfig.cities[initialCity].split(',').map(Number)
      el('lat').value = lat
      el('lon').value = lon
      await performFetch(lat, lon)
    } else {
      citySelect.value = ''
      setMessage('Choose a city from the list or use location.', 'info')
    }
  }catch(e){
    setMessage('Unable to load configuration: ' + e.message, 'error')
  }

  await loadHistory()
}

initializeApp()
