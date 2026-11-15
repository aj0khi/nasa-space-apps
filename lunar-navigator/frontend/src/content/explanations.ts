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
    "This is a side-on slice through the measured ground, like cutting a cake. The slice stays locked in one direction, so the ground does not move while you change the time. When a site opens, the slice points at the Sun. Press \"Next sunset\" or \"Next sunrise\" to turn it to where the Sun will cross the skyline, then drag the time to watch the Sun sink behind, or rise over, the real terrain. When the Sun is in line with the slice, a dashed line shows what the lander sees, at the Sun's real angle. When the Sun is off to the side, it is drawn as a hollow circle at its real height with no line, because a side-on picture cannot show a direction that leaves the page. The small map shows where it is. Orange ground gets sunlight and blue ground is in shadow. Once the ground has been ray traced, every point on the slice is checked against the terrain in all directions. Until then the colours show only shadows cast by ground on this one line, and the panel says so. The \"Landing spot\" answer is always ray traced in every direction around the lander, from the eye height you choose: a taller mast can see over the ground beside the lander. Heights are drawn at true scale when the relief shows. Otherwise they are stretched, the drawing says by how much, and a small 1:1 picture shows the true shape. Press ▶ to watch a whole lunar day (about 29.5 Earth days) go by. The bar underneath shows which spots get the most sun over that day.",
  profileEarth:
    "Radio travels in straight lines, just like light. If a crater wall stands between the lander and Earth, the signal is blocked. Blue ground can see Earth and talk to home directly. Red ground cannot, and would need a relay satellite. Near the pole Earth sits very low in the sky and bobs up and down over a month, so contact comes and goes. The slice stays locked in one direction. Press \"Lock to Earth now\" to point it at Earth, or \"Next Earthset\" or \"Next Earthrise\" to line it up with the place where Earth crosses the skyline. When Earth is in line with the slice, the dashed line shows what the lander sees, at Earth's real angle. When Earth is off to the side, it is drawn as a hollow circle at its real height with no line. The \"Call home?\" answer is ray traced through the terrain in every direction around the lander, from the eye height you choose.",
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
