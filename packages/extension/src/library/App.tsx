import {
  DatabaseBackup,
  FolderSearch,
  ListMusic,
  ListOrdered,
  Music2,
  Settings,
  Tags,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router';
import { BackupPage } from './pages/Backup';
import { CategoriesPage } from './pages/Categories';
import { PlaylistDetailPage } from './pages/PlaylistDetail';
import { PlaylistsPage } from './pages/Playlists';
import { ResearchDetailPage } from './pages/ResearchDetail';
import { ResearchesPage } from './pages/Researches';
import { SettingsPage } from './pages/Settings';
import { TracksPage } from './pages/Tracks';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Pesquisas', icon: <FolderSearch size={16} aria-hidden />, end: true },
  { to: '/tracks', label: 'Músicas', icon: <ListMusic size={16} aria-hidden /> },
  { to: '/categories', label: 'Categorias', icon: <Tags size={16} aria-hidden /> },
  { to: '/playlists', label: 'Playlists', icon: <ListOrdered size={16} aria-hidden /> },
  { to: '/backup', label: 'Backup', icon: <DatabaseBackup size={16} aria-hidden /> },
  { to: '/settings', label: 'Configurações', icon: <Settings size={16} aria-hidden /> },
];

export interface ExtraRoute {
  path: string;
  element: ReactNode;
}

export function Layout(props: { children: ReactNode; nav?: NavItem[] }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-neutral-900 md:flex-row dark:bg-neutral-950 dark:text-neutral-100">
      <aside className="border-b border-neutral-200 md:w-56 md:shrink-0 md:border-r md:border-b-0 dark:border-neutral-800">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-white">
            <Music2 size={16} aria-hidden />
          </span>
          <span className="text-lg font-semibold tracking-tight">CuePoint</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col" aria-label="Seções">
          {(props.nav ?? NAV).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap ${
                  isActive
                    ? 'bg-orange-50 font-medium text-orange-700 dark:bg-orange-950/40 dark:text-orange-300'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{props.children}</main>
    </div>
  );
}

export function App(props: { extraNav?: NavItem[]; extraRoutes?: ExtraRoute[] }) {
  return (
    <HashRouter>
      <Layout nav={[...NAV, ...(props.extraNav ?? [])]}>
        <Routes>
          <Route path="/" element={<ResearchesPage />} />
          <Route path="/researches/:id" element={<ResearchDetailPage />} />
          <Route path="/tracks" element={<TracksPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
          <Route path="/backup" element={<BackupPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {props.extraRoutes?.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
        </Routes>
      </Layout>
    </HashRouter>
  );
}
