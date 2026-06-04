'use client'

import { useState } from 'react'
import { ContentCard } from '../../ui/ContentCard'
import { ToggleSwitch } from '../../ui/ToggleSwitch'

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeType = 'trigger' | 'condition' | 'action'

interface AutomationNode {
  id: string
  type: NodeType
  title: string
  description: string
}

interface WorkflowItem {
  id: string
  name: string
  description: string
  status: 'active' | 'inactive'
  lastRun: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_CONFIG: Record<NodeType, { icon: string; label: string; borderClass: string; textClass: string }> = {
  trigger:   { icon: 'bolt',        label: 'Trigger',   borderClass: 'border-l-4 border-primary-container', textClass: 'text-primary' },
  condition: { icon: 'filter_list', label: 'Condition', borderClass: 'border-l-4 border-tertiary',          textClass: 'text-tertiary' },
  action:    { icon: 'send',        label: 'Action',    borderClass: 'border-l-4 border-secondary',         textClass: 'text-secondary' },
}

const SAMPLE_WORKFLOWS: WorkflowItem[] = [
  { id: '1', name: 'Group Seeder v2',  description: 'Join → Post → DM sequence',  status: 'active',   lastRun: '2h ago' },
  { id: '2', name: 'Page Warm-Up',     description: 'Like → Comment → Share loop', status: 'active',   lastRun: '5h ago' },
  { id: '3', name: 'BM Rotation',      description: 'Create → Transfer → Verify',  status: 'inactive', lastRun: '1d ago' },
]

const SAMPLE_NODES: AutomationNode[] = [
  { id: 'n1', type: 'trigger',   title: 'Schedule Trigger',  description: 'Runs daily at 09:00 UTC' },
  { id: 'n2', type: 'condition', title: 'Health Check',       description: 'Only proceed if session is live' },
  { id: 'n3', type: 'action',    title: 'Post to Groups',     description: 'Post content to 50 target groups' },
]

/**
 * FunnelBuilderView — Automation Builder with workflow library and visual node canvas.
 *
 * Left panel (col-span-4): workflow library list with status indicators.
 * Right panel (col-span-8): node canvas with trigger/condition/action nodes connected by lines.
 *
 * Satisfies: Requirements 7.1–7.7, 16.1
 */
export function FunnelBuilderView() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('1')
  const [workflowName, setWorkflowName] = useState('Group Seeder v2')
  const [workflowActive, setWorkflowActive] = useState(true)
  const [nodes, setNodes] = useState<AutomationNode[]>(SAMPLE_NODES)

  const handleSaveDeploy = async () => {
    // Save and deploy logic — preserved for future implementation
    console.log('Save & Deploy:', { workflowName, nodes, workflowActive })
  }

  const handleDiscard = () => {
    setWorkflowName('Group Seeder v2')
    setNodes(SAMPLE_NODES)
  }

  return (
    <div className="grid grid-cols-12 gap-6 p-8 h-full overflow-hidden bg-background">

      {/* ── LEFT PANEL — Workflow Library ─────────────────────────────────── */}
      <div className="col-span-4 flex flex-col gap-4 overflow-y-auto">

        {/* Library header */}
        <ContentCard padding="sm">
          <div className="flex items-center justify-between">
            <h2 className="text-headline-md font-semibold text-on-surface">Library</h2>
            <span className="bg-secondary-container text-secondary text-label-sm font-semibold px-2 py-0.5 rounded-badge">
              {SAMPLE_WORKFLOWS.filter(w => w.status === 'active').length} Active
            </span>
          </div>
        </ContentCard>

        {/* Workflow list */}
        {SAMPLE_WORKFLOWS.map(workflow => (
          <ContentCard
            key={workflow.id}
            hover
            className={`cursor-pointer transition-all ${selectedWorkflow === workflow.id ? 'ring-2 ring-primary' : ''}`}
          >
            <button
              className="w-full text-left"
              onClick={() => { setSelectedWorkflow(workflow.id); setWorkflowName(workflow.name) }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-primary">account_tree</span>
                  <div>
                    <p className="text-body-md font-medium text-on-surface">{workflow.name}</p>
                    <p className="text-label-sm text-on-surface-variant mt-0.5">{workflow.description}</p>
                  </div>
                </div>
                <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${workflow.status === 'active' ? 'bg-secondary' : 'bg-outline'}`} />
              </div>
              <p className="text-label-sm text-on-surface-variant mt-2">Last run: {workflow.lastRun}</p>
            </button>
          </ContentCard>
        ))}

        {/* New Automation dashed card */}
        <button className="w-full border-2 border-dashed border-outline-variant rounded-card p-4 flex items-center justify-center gap-2 text-on-surface-variant hover:border-primary hover:text-primary transition-colors">
          <span className="material-symbols-outlined text-[20px]">add</span>
          <span className="text-body-md font-medium">New Automation</span>
        </button>
      </div>

      {/* ── RIGHT PANEL — Canvas ───────────────────────────────────────────── */}
      <div className="col-span-8 flex flex-col gap-4 overflow-y-auto">

        {/* Toolbar */}
        <ContentCard padding="sm">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={workflowName}
              onChange={e => setWorkflowName(e.target.value)}
              className="flex-1 bg-transparent text-headline-md font-semibold text-on-surface border-none outline-none focus:bg-surface-container rounded px-2 py-1 transition-colors"
            />
            <span className="text-label-sm text-on-surface-variant whitespace-nowrap">Last saved 2 min ago</span>
            <button
              onClick={handleDiscard}
              className="bg-surface-container-lowest border border-outline-variant text-on-surface rounded-button px-4 py-[7px] text-body-md hover:bg-surface-container transition-colors"
            >
              Discard
            </button>
            <button
              onClick={handleSaveDeploy}
              className="bg-primary-container text-on-primary rounded-button px-4 py-[7px] text-body-md font-medium hover:opacity-90 transition-opacity"
            >
              Save &amp; Deploy
            </button>
          </div>
        </ContentCard>

        {/* Node canvas */}
        <div className="flex flex-col items-center gap-0">
          {nodes.map((node, index) => {
            const config = NODE_CONFIG[node.type]
            return (
              <div key={node.id} className="w-full flex flex-col items-center">
                {/* Node card */}
                <ContentCard className={`w-full ${config.borderClass}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`material-symbols-outlined text-[20px] ${config.textClass}`}>
                        {config.icon}
                      </span>
                      <div>
                        <p className={`text-label-sm font-semibold uppercase tracking-wider ${config.textClass}`}>
                          {config.label}
                        </p>
                        <p className="text-body-md font-medium text-on-surface mt-0.5">{node.title}</p>
                        <p className="text-label-sm text-on-surface-variant mt-0.5">{node.description}</p>
                      </div>
                    </div>
                    <button className="text-on-surface-variant hover:text-on-surface transition-colors">
                      <span className="material-symbols-outlined text-[18px]">more_horiz</span>
                    </button>
                  </div>
                </ContentCard>

                {/* Connector line + add button between nodes */}
                {index < nodes.length - 1 && (
                  <div className="flex flex-col items-center py-1">
                    <div className="w-0.5 h-4 bg-primary-container" />
                    <button className="w-6 h-6 rounded-full bg-primary-container text-on-primary flex items-center justify-center hover:opacity-90 transition-opacity text-[14px] font-bold">
                      +
                    </button>
                    <div className="w-0.5 h-4 bg-primary-container" />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Canvas footer */}
        <ContentCard padding="sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-label-sm text-on-surface-variant">
              <span>
                <span className="font-semibold text-on-surface">1,240</span> views
              </span>
              <span>
                <span className="font-semibold text-secondary">94%</span> success rate
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-label-sm text-on-surface-variant">Workflow Active</span>
              <ToggleSwitch checked={workflowActive} onChange={setWorkflowActive} />
            </div>
          </div>
        </ContentCard>
      </div>
    </div>
  )
}
