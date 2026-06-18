import { useFailoverStore } from "@/store/failoverStore"
import { normalizeAddonUrl } from "@/lib/utils"

class AutopilotManager {
    /**
     * Called when a user manually toggles an addon's enabled state.
     * If that addon is part of an active Autopilot rule, we may need to
     * disable automatic mode to respect the user's manual choice.
     */
    handleManualToggle(accountId: string, transportUrl: string) {
        const { rules, updateRule } = useFailoverStore.getState()
        const normalizedUrl = normalizeAddonUrl(transportUrl)

        const activeRules = rules.filter(r => r.accountId === accountId && r.isActive)

        for (const rule of activeRules) {
            const chain = rule.priorityChain || []
            const normalizedChain = chain.map((u: string) => normalizeAddonUrl(u))

            if (normalizedChain.includes(normalizedUrl)) {
                if (import.meta.env.DEV) console.log(`[Autopilot] Manual override detected for rule ${rule.id}. Disabling automatic mode and deactivating rule.`)

                updateRule(rule.id, {
                    isActive: false,
                    isAutomatic: false
                })
            }
        }
    }

    canAutomate(ruleId: string): boolean {
        const rule = useFailoverStore.getState().rules.find(r => r.id === ruleId)
        if (!rule) return false

        return rule.isActive && (rule.isAutomatic !== false)
    }
}

export const autopilotManager = new AutopilotManager()
