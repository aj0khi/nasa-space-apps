// Plain-language text for beginner mode. Owner: GEO. No code knowledge needed. Just edit the strings.

export const explain = {
  sunTab: "This shows where sunlight comes from right now. On the Moon the Sun moves very slowly. One full day and night lasts about 29.5 Earth days.",
  shadowsTab: "Dark areas get no sunlight. At the poles the Sun stays low, so crater walls cast huge shadows. Some crater floors haven't seen sunlight in billions of years.",
  rimsTab: "Rims are the raised edges of craters. They stick up into the sunlight, so solar panels work there, and icy dark craters are close by. That's why we land on rims.",
  skyDome: "This is the sky above the landing site. The center is straight up and the edge is the horizon. ☀️ = Sun, 🌍 = Earth. If Earth is below the horizon, we can't talk to home directly.",
  crossSection: "Imagine slicing the ground like a cake and looking at it from the side. This is the height of the land along a line through the landing site.",
  score: "Green = good power and contact with Earth. Yellow = workable with care. Red = risky: long darkness, no Earth contact, or steep ground.",
  shadowsToHeights: "Shadows tell us heights. A taller hill makes a longer shadow. If we know how high the Sun is, we can work out how tall the hill is.",
  southPole:
    "This is the bottom of the Moon, seen from straight above. The black-floored craters are permanently shadowed: the Sun never reaches them, so they stay colder than −200 °C and can trap water ice. Landing sites sit on the sunny edges right next to them.",
  sunMap:
    "The Sun goes all the way around the pole once every 29.5 Earth days, always just skimming the horizon. Press ▶ next to the date to watch it. Warm ground is in sunlight right now and blue ground is in shadow. Tall rims and mountains catch the light, while deep crater floors never do. A site that stays lit for longer can charge its batteries, so it scores better.",
  profile:
    "This is a side-on slice through the measured ground, like cutting a cake. Short slices are drawn at true scale. Long ones stretch the heights so the relief shows, and say so. Orange ground gets sunlight, blue ground is in shadow. Near the pole the Sun sits very low, so its real angle is printed on the drawing and the dashed line shows what the lander sees when it looks toward the Sun. The slice can point in 16 fixed directions and the date and time pick the one that faces the Sun, so the ground stays still while the Sun moves. The \"Landing spot\" answer is ray traced through the terrain in every direction around the lander. The colours on the slice only show shadows cast by ground on this one line. Press ▶ to watch a whole lunar day (about 29.5 Earth days) go by. The bar underneath shows which spots got the most sun over that day.",
  profileEarth:
    "Radio travels in straight lines, just like light. If a crater wall stands between the lander and Earth, the signal is blocked. Blue ground can see Earth and talk to home directly. Red ground cannot, and would need a relay satellite. Near the pole Earth sits very low in the sky and bobs up and down over a month, so contact comes and goes. The \"Call home?\" answer is ray traced through the terrain in every direction around the lander, and the dashed line shows what the lander sees when it looks toward Earth.",
  // TODO(GEO): add text for split view, mission panel, timeline, resources, seasons
};

export const moonVsEarth = [
  { label: "Length of a day (sunrise to sunrise)", moon: "29.5 Earth days", earth: "24 hours" },
  { label: "Axis tilt", moon: "1.5°", earth: "23.4°" },
  { label: "Seasons", moon: "Almost none", earth: "Strong" },
  { label: "Atmosphere / weather", moon: "None", earth: "Yes" },
  { label: "Surface temperature", moon: "−170 °C to +120 °C (−240 °C in dark craters)", earth: "−50 °C to +50 °C (typical)" },
  // TODO(GEO): verify numbers, add gravity, distance, etc.
];
