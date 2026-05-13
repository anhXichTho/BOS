import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile, UserPreferences } from '../types'

interface AuthContextValue {
  user: User | null
  session: Session | null
  profile: Profile | null
  /** True if user is in `leader_members` (org hierarchy — has subordinates). */
  isLeader: boolean
  isAdmin: boolean
  isEditor: boolean
  /** True if profile.role === 'leader' — a role that can create channels/projects
   *  but only sees what they own/are member of. Distinct from `isLeader`
   *  (org-hierarchy flag). */
  isRoleLeader: boolean
  /** Admin / editor / role-leader → can create channels & projects. */
  canCreateResources: boolean
  canManageTemplates: boolean
  /** Group IDs the current user belongs to. */
  groupIds: string[]
  /** Convenience: is the current user a member of the given group? */
  inGroup: (groupId: string) => boolean
  /** User preferences (sidebar pin, notification mute, theme). */
  preferences: UserPreferences
  /** Persist a partial preferences patch to the profile row. */
  updatePreferences: (patch: Partial<UserPreferences>) => Promise<void>
  /** Update editable profile fields (e.g. full_name) with optimistic UI. */
  updateProfile: (patch: { full_name?: string }) => Promise<void>
  /** Personal channel ID (Phase 3). Null until migration runs or on error. */
  selfChatId: string | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<User | null>(null)
  const [session, setSession]     = useState<Session | null>(null)
  const [profile, setProfile]     = useState<Profile | null>(null)
  const [isLeader, setIsLeader]   = useState(false)
  const [groupIds, setGroupIds]   = useState<string[]>([])
  const [selfChatId, setSelfChatId] = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) loadAuthState(session.user.id)
      else setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) loadAuthState(session.user.id)
      else {
        setProfile(null)
        setIsLeader(false)
        setGroupIds([])
        setSelfChatId(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadAuthState(userId: string) {
    try {
      // Fetch profile + leader flag + group memberships + self-chat in parallel.
      // user_group_members and get_or_create_self_chat may be absent on older
      // deployments — tolerate gracefully (gotcha #17).
      const [profileRes, leaderRes, groupsRes, selfChatRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).single(),
        supabase.from('leader_members').select('id').eq('leader_id', userId).limit(1),
        supabase.from('user_group_members').select('group_id').eq('user_id', userId),
        supabase.rpc('get_or_create_self_chat'),
      ])
      if (profileRes.data) setProfile(profileRes.data as Profile)
      setIsLeader((leaderRes.data?.length ?? 0) > 0)
      if (groupsRes.error) {
        // Table missing on stale environments — don't break sign-in.
        setGroupIds([])
      } else {
        setGroupIds((groupsRes.data ?? []).map(r => r.group_id as string))
      }
      if (selfChatRes.error) {
        // Function missing (migration not yet run) — stay null, no crash.
        console.warn('[AuthContext] get_or_create_self_chat unavailable:', selfChatRes.error.message)
        setSelfChatId(null)
      } else {
        setSelfChatId((selfChatRes.data as { id?: string })?.id ?? null)
      }
    } catch (err) {
      console.error('Failed to load auth state:', err)
    } finally {
      setLoading(false)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function updatePreferences(patch: Partial<UserPreferences>) {
    if (!user) return
    const merged = { ...(profile?.preferences ?? {}), ...patch }
    setProfile(p => (p ? { ...p, preferences: merged } : p))
    const { error } = await supabase
      .from('profiles')
      .update({ preferences: merged })
      .eq('id', user.id)
    if (error) {
      console.error('Failed to save preferences:', error)
      // Reload to reset optimistic state on failure.
      loadAuthState(user.id)
    }
  }

  async function updateProfile(patch: { full_name?: string }) {
    if (!user) return
    setProfile(p => (p ? { ...p, ...patch } : p))
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
    if (error) {
      console.error('Failed to update profile:', error)
      loadAuthState(user.id)
    }
  }

  const isAdmin    = profile?.role === 'admin'
  const isEditor   = profile?.role === 'editor'
  const isRoleLeader = profile?.role === 'leader'
  const canCreateResources = isAdmin || isEditor || isRoleLeader
  const canManageTemplates = isAdmin || isEditor || isLeader
  const preferences = (profile?.preferences ?? {}) as UserPreferences
  const inGroup    = (groupId: string) => groupIds.includes(groupId)

  return (
    <AuthContext.Provider value={{
      user, session, profile, isLeader, isAdmin, isEditor, isRoleLeader, canCreateResources,
      canManageTemplates, groupIds, inGroup,
      preferences, updatePreferences, updateProfile,
      selfChatId,
      loading, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
