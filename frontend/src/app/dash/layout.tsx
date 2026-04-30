import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Brawlers · Dev Dashboard',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    noarchive: true,
    nosnippet: true,
    notranslate: true,
  },
};

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
