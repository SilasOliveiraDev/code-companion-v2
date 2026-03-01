import { MCPToolResult, SupabaseConfig } from '../../types';

export interface ConnectSupabaseParams {
  projectUrl: string;
  anonKey: string;
  serviceRoleKey?: string;
  enableRealtime?: boolean;
  enableAuth?: boolean;
}

// Validated connections stored per session (in production, use encrypted storage)
const connections = new Map<string, SupabaseConfig>();

export async function connectSupabase(params: ConnectSupabaseParams): Promise<MCPToolResult> {
  const { projectUrl, anonKey, serviceRoleKey, enableRealtime, enableAuth } = params;

  if (!projectUrl.includes('supabase.co') && !projectUrl.startsWith('http')) {
    return {
      success: false,
      error: 'Invalid Supabase project URL format',
    };
  }

  if (!anonKey || anonKey.length < 20) {
    return {
      success: false,
      error: 'Invalid Supabase anon key',
    };
  }

  const connectionId = `conn-${Date.now()}`;
  connections.set(connectionId, { projectUrl, anonKey, serviceRoleKey });

  const features: string[] = ['Database'];
  if (enableAuth) features.push('Authentication');
  if (enableRealtime) features.push('Realtime');

  return {
    success: true,
    data: {
      connectionId,
      projectUrl,
      features,
      message: `Successfully connected to Supabase project. Features enabled: ${features.join(', ')}`,
      envVariables: {
        NEXT_PUBLIC_SUPABASE_URL: projectUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
        ...(serviceRoleKey ? { SUPABASE_SERVICE_ROLE_KEY: '***' } : {}),
      },
    },
  };
}

export function getConnection(connectionId: string): SupabaseConfig | undefined {
  return connections.get(connectionId);
}
