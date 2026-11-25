export function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark${small ? ' small' : ''}`} aria-hidden="true">
    <img src={`${import.meta.env.BASE_URL}moonweave-logo-v2.png`} alt="" />
  </span>
}
