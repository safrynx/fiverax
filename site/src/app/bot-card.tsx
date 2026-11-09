/* eslint-disable @next/next/no-img-element */
import "./bot-card.css";

/** The bot as members see its profile on Discord: banner, avatar, name with the APP tag, "About me". Live preview of the forms. */
export default function BotCard({ name, bio, avatarUrl, bannerUrl, caption }: { name: string; bio: string | null; avatarUrl: string | null; bannerUrl: string | null; caption?: string }) {
  return (
    <figure className="bot-card" aria-label={`Aperçu du profil de ${name}`}>
      <div className="bot-card-banner">{bannerUrl && <img src={bannerUrl} alt="" />}</div>
      <div className="bot-card-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}</div>
      <div className="bot-card-body">
        <div className="bot-card-name"><b>{name || "Fiverax"}</b><span className="bot-card-tag">✓ APP</span></div>
        {bio ? (
          <div className="bot-card-about"><small>À propos de moi</small><p>{bio}</p></div>
        ) : (
          <p className="bot-card-empty">Pas de bio</p>
        )}
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
