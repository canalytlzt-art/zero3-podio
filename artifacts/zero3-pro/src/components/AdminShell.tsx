import { Activity, ClipboardList, Users, UserRound, LayoutDashboard, LogOut, Radio, ListChecks, FileSpreadsheet, Trophy } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import type { ReactNode } from 'react';
import { tvHrefForEvent } from '@/lib/tv-navigation';
import { liveBoardHrefForEvent } from '@/lib/live-board-navigation';
import { queryErrorMessage } from '@/lib/api-error-policy';

const nav = [
  { href: '/admin', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/admin/events', label: 'Eventos', icon: ClipboardList },
  { href: '/operacao', label: 'Operação', icon: Activity },
  { href: '/admin/roster', label: 'Atletas', icon: UserRound },
  { href: '/admin/roster/manage', label: 'Equipes', icon: ListChecks },
  { href: '/admin/roster/import', label: 'Importar duplas', icon: FileSpreadsheet },
  { href: '/admin/members', label: 'Equipe de operação', icon: Users },
];

export function AdminShell({ children, tvEventId }: { children: ReactNode; tvEventId?: string | null }) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const initials = (user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Z').slice(0, 1).toUpperCase();
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand"><span className="brand-mark">03</span><span>ZERO3<small> PRO</small></span></Link>
      <div className="nav-label">Operação</div>
      {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href || (href !== '/admin' && location.startsWith(href)) ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={16}/><span>{label}</span></Link>)}
      <div className="nav-label">Transmissão</div>
       <Link href={tvHrefForEvent(tvEventId)} target="_blank" rel="noopener noreferrer" className="nav-link"><Radio size={16}/><span>TV pública</span></Link>
       <Link href={liveBoardHrefForEvent(tvEventId)} target="_blank" rel="noopener noreferrer" className="nav-link" data-testid="link-nav-placar-ao-vivo"><Trophy size={16}/><span>Placar ao Vivo</span></Link>
      <div className="side-foot">SISTEMA DE COMPETIÇÃO<br/>SANTA CATARINA · BR</div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="topbar-label">Painel de controle / {nav.find(item => item.href === location)?.label || 'Evento'}</div>
        <div className="user-chip"><span>{user?.primaryEmailAddress?.emailAddress || 'Operador autenticado'}</span><span className="avatar">{initials}</span><button className="button small" aria-label="Sair" data-testid="button-sign-out" onClick={() => signOut({ redirectUrl: '/' })}><LogOut size={14}/></button></div>
      </header>
      <main className="content">{children}</main>
    </div>
  </div>;
}

export function PageHeading({ eyebrow, title, detail, children }: { eyebrow: string; title: string; detail?: string; children?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{detail && <p className="lede">{detail}</p>}</div>{children && <div className="toolbar">{children}</div>}</div>;
}

export function LoadingRows() { return <div style={{display:'grid',gap:10}} aria-label="Carregando"><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/></div>; }
export function QueryError({ retry, error, testId = 'button-query-retry' }: { retry: () => void; error?: unknown; testId?: string }) { return <div className="error-box" role="alert"><span>{queryErrorMessage(error)}</span><button className="button small" data-testid={testId} onClick={retry}>Tentar novamente</button></div>; }
export function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty"><div className="empty-mark"><Activity size={17}/></div><strong>{title}</strong><p>{detail}</p></div>; }
