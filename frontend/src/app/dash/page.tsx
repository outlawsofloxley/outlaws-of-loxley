'use client';

import { DashAuthGate } from '@/components/dash/DashAuthGate';
import { StatsPanels } from '@/components/dash/StatsPanels';
import { SettingsEditors } from '@/components/dash/SettingsEditors';
import { HouseManagementPanel } from '@/components/dash/HouseManagementPanel';
import { BrawlPricePanel } from '@/components/dash/BrawlPricePanel';
import { LiveEconomicsPanel } from '@/components/dash/LiveEconomicsPanel';
import { EmergencyUnstickPanel } from '@/components/dash/EmergencyUnstickPanel';
import { LaunchChecklist } from '@/components/dash/LaunchChecklist';
import { RosterReadyPanel } from '@/components/dash/RosterReadyPanel';

export default function DashPage() {
  return (
    <DashAuthGate>
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8 space-y-10">
        <div className="space-y-1">
          <h1 className="brawl-header text-2xl md:text-3xl text-brawl-orange">
            Dev dashboard
          </h1>
          <p className="text-sm text-brawl-text-dim">
            Not linked in nav. Session cookie required. Writes happen from your connected dev wallet.
          </p>
        </div>

        <StatsPanels />

        <div className="grid gap-6 md:grid-cols-2">
          <RosterReadyPanel />
          <LiveEconomicsPanel />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <BrawlPricePanel />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <EmergencyUnstickPanel />
        </div>

        <HouseManagementPanel />

        <SettingsEditors />

        <LaunchChecklist />

        <div className="text-sm text-brawl-text-faint text-center py-8">
          Brawlers /dash · session HMAC-signed · audited writes land in <code>audit_log</code>
        </div>
      </div>
    </DashAuthGate>
  );
}
