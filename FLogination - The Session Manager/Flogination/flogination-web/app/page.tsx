'use client';
import { useEffect, useState } from 'react';
import { useStore } from '../../../src/store';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/views/Dashboard';
import { AccountsView } from './components/views/AccountsView';
import { InboxView } from './components/views/InboxView';
import { CampaignsView } from './components/views/CampaignsView';
import { ProxiesView } from './components/views/ProxiesView';
import { SettingsView } from './components/views/SettingsView';
import { LogsView } from './components/views/LogsView';
import { GridView } from './components/views/GridView';
import { ContactsView } from './components/views/ContactsView';
import { PageFactoryView } from './components/views/tools/PageFactoryView';
import { BMFactoryView } from './components/views/tools/BMFactoryView';
import { GroupHunterView } from './components/views/tools/GroupHunterView';
import { CommentMarketingView } from './components/views/tools/CommentMarketingView';
import { ContentAmplifierView } from './components/views/tools/ContentAmplifierView';
import { BrowserRecorderView } from './components/views/tools/BrowserRecorderView';
import { FunnelBuilderView } from './components/views/tools/FunnelBuilderView';
import { WarmUpView } from './components/views/WarmUpView';
import { ErrorBoundary } from './components/ErrorBoundary';

function PlaceholderView({ title }: { title: string }) {
  return (
    <div className="flex-1 flex items-center justify-center flex-col gap-4">
      <span className="material-symbols-outlined text-[48px] text-on-surface-variant">construction</span>
      <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
      <p className="font-body-sm text-body-sm text-on-surface-variant">This view is being built.</p>
    </div>
  );
}

export default function App() {
  const { currentView, sidebarCollapsed, fetchSettings } = useStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    fetchSettings();
    setMounted(true);
  }, []);

  const collapsed = mounted ? sidebarCollapsed : false;
  const mainMargin = collapsed ? 'ml-[52px]' : 'ml-[240px]';

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':              return <Dashboard />;
      case 'accounts':               return <AccountsView />;
      case 'inbox':                  return <InboxView />;
      case 'inbox-warmup':           return <WarmUpView />;
      case 'inbox-contacts':         return <ContactsView />;
      case 'campaigns':              return <CampaignsView />;
      case 'proxies':                return <ProxiesView />;
      case 'settings':               return <SettingsView />;
      case 'tools-page-factory':     return <PageFactoryView />;
      case 'tools-bm-factory':       return <BMFactoryView />;
      case 'tools-group-hunter':     return <GroupHunterView />;
      case 'tools-comment-marketing':return <CommentMarketingView />;
      case 'tools-content-amplifier':return <ContentAmplifierView />;
      case 'tools-browser-recorder': return <BrowserRecorderView />;
      case 'funnels':                return <FunnelBuilderView />;
      case 'grid':                   return <GridView />;
      case 'logs':                   return <LogsView />;
      default:                       return <Dashboard />;
    }
  };

  return (
    <div className="bg-background text-on-surface overflow-hidden flex h-screen">
      <Sidebar />
      <div className={`flex flex-col flex-1 h-screen overflow-hidden transition-all duration-300 ${mainMargin}`}>
        <TopBar />
        <main className="flex-1 overflow-hidden relative mt-[48px]">
          <ErrorBoundary>
            <div key={currentView} className="view-enter h-full">
              {renderView()}
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
