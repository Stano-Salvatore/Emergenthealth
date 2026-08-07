// Rain/snow/fog particles + the day-night light rig. The app supplies the
// weather (its own API already serves Open-Meteo codes), so this module only
// renders effects — it never fetches or asks for geolocation.
import { THREE, M, mk, group } from './core.js';

const R = 6, TOP = 6.5;

/** Precipitation + light rig that reads a weather state. */
export function buildWeatherFX() {
  const root = group('weather');
  const N = 900;

  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    rainPos[i * 3] = (Math.random() - 0.5) * R * 2;
    rainPos[i * 3 + 1] = Math.random() * TOP;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * R * 2;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = Object.assign(new THREE.PointsMaterial({ color: 0xbdd9e8, size: 0.05, transparent: true, opacity: 0.75 }), { name: 'precip_rain' });
  const rain = new THREE.Points(rainGeo, rainMat); rain.name = 'precip_rain'; rain.visible = false; root.add(rain);

  const snowMat = Object.assign(new THREE.PointsMaterial({ color: 0xffffff, size: 0.11, transparent: true, opacity: 0.9 }), { name: 'precip_snow' });
  const snow = new THREE.Points(rainGeo.clone(), snowMat); snow.name = 'precip_snow'; snow.visible = false; root.add(snow);

  const fog = group('weather_fog');
  for (let i = 0; i < 7; i++) {
    const b = mk(`fog_bank_${i}`, new THREE.SphereGeometry(1.5, 12, 8),
      Object.assign(new THREE.MeshStandardMaterial({ color: 0xdfe3e6, transparent: true, opacity: 0.16, roughness: 1 }), { name: 'fog_bank' }),
      Math.cos(i * 0.9) * 3.4, 0.5 + (i % 3) * 0.25, Math.sin(i * 0.9) * 3.4);
    b.scale.set(1.6, 0.45, 1.4); fog.add(b);
  }
  fog.visible = false; root.add(fog);

  const sun = new THREE.DirectionalLight(0xfff0d0, 0.5); sun.name = 'weather_sun'; sun.position.set(4, 7, 3); root.add(sun);
  const amb = new THREE.HemisphereLight(0xcfe4f5, 0x4a3d2a, 0.4); amb.name = 'weather_ambient'; root.add(amb);

  let state = { kind: 'clear', isDay: true, windKph: 5 };

  return {
    root,
    setWeather(w) {
      state = w;
      const k = w.kind;
      rain.visible = k === 'rain';
      snow.visible = k === 'snow';
      fog.visible = k === 'fog';
      sun.intensity = w.isDay ? (k === 'clear' ? 0.6 : k === 'cloudy' ? 0.3 : 0.15) : 0.05;
      sun.color.set(w.isDay ? 0xfff0d0 : 0x9fb6d8);
      amb.intensity = w.isDay ? 0.45 : 0.16;
      amb.color.set(w.isDay ? 0xcfe4f5 : 0x2f3d5c);
      M.glow.emissive = new THREE.Color(0xffc46a);
      M.glow.emissiveIntensity = w.isDay ? 0.15 : 1.0;
      M.glow.needsUpdate = true;
    },
    update(dt) {
      const fall = state.kind === 'snow' ? 0.9 : 7.5;
      const drift = Math.min(state.windKph, 40) / 30;
      const target = state.kind === 'snow' ? snow : rain;
      if (!target.visible) return;
      const pos = target.geometry.attributes.position;
      for (let i = 0; i < N; i++) {
        let y = pos.getY(i) - fall * dt;
        let x = pos.getX(i) + drift * dt * (state.kind === 'snow' ? 0.8 : 1.6);
        if (y < -0.5) { y = TOP; x = (Math.random() - 0.5) * R * 2; pos.setZ(i, (Math.random() - 0.5) * R * 2); }
        if (x > R) x -= R * 2;
        pos.setY(i, y); pos.setX(i, x);
      }
      pos.needsUpdate = true;
    },
  };
}
