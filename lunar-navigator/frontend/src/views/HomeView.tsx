export default function HomeView() {
  return (
    <div className="home">
      <header className="home-header">
        <a className="home-brand" href="#/home"><span className="home-mark" aria-hidden="true" /> Lunar Landing Site Navigator</a>
        <a className="home-nav-link" href="#/2d">Explore the lunar map <span aria-hidden="true">↗</span></a>
      </header>
      <main>
        <section className="home-hero">
          <div className="home-hero-copy">
            <p className="home-eyebrow">NASA Space Apps Challenge · Lunar exploration</p>
            <h1>Find a place<br />in the sunlight.</h1>
            <p className="home-intro">Explore the Moon’s south pole, follow the changing Sun, and compare the terrain around potential landing sites.</p>
            <a className="home-cta" href="#/2d">Explore the lunar map <span aria-hidden="true">→</span></a>
            <p className="home-note">An exploratory tool, not validated landing guidance.</p>
          </div>
          <div className="home-imagery" aria-hidden="true"><div className="home-image-label">01 / SOUTH POLAR RELIEF</div></div>
        </section>
        <section className="home-overview" aria-labelledby="home-overview-title">
          <div><p className="home-eyebrow">A closer look</p><h2 id="home-overview-title">A new perspective<br />on the lunar surface.</h2></div>
          <ol className="home-features" role="list">
            <li><span>01</span><div><h3>Explore the terrain</h3><p>Browse NASA Moon Trek imagery and select a site on the map.</p></div></li>
            <li><span>02</span><div><h3>Follow the light</h3><p>Change the date to explore modeled sunlight and shadows.</p></div></li>
            <li><span>03</span><div><h3>Compare perspectives</h3><p>Inspect a cross section, explore in 3D, and compare sites.</p></div></li>
          </ol>
        </section>
      </main>
      <footer className="home-footer"><span>Lunar Landing Site Navigator</span><span>Imagery: NASA / GSFC / MIT / Moon Trek</span></footer>
    </div>
  );
}
