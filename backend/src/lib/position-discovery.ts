/**
 * Position Discovery — queries The Graph for all V4 positions owned by an address.
 *
 * Uses the same Uniswap V4 subgraph as the Alphix frontend (discover.ts).
 */

const UNISWAP_V4_SUBGRAPH_ID = 'Gqm2b5J85n1bhCyDMpGbtbVn4935EvvdyHdHrx3dibyj';

const GRAPH_API_KEY = process.env.GRAPH_API_KEY || process.env.NEXT_PUBLIC_GRAPH_API_KEY || '';

function getSubgraphUrl(): string | null {
  if (!GRAPH_API_KEY) return null;
  return `https://gateway.thegraph.com/api/${GRAPH_API_KEY}/subgraphs/id/${UNISWAP_V4_SUBGRAPH_ID}`;
}

const QUERY = `
  query GetPositions($owner: String!) {
    positions(
      where: { owner: $owner }
      first: 100
      orderBy: createdAtTimestamp
      orderDirection: desc
    ) {
      id
      tokenId
      owner
    }
  }
`;

export interface DiscoveredPosition {
  tokenId: string;
}

/**
 * Discover all V4 positions owned by an address via The Graph subgraph.
 */
export async function discoverPositions(ownerAddress: string): Promise<DiscoveredPosition[]> {
  const url = getSubgraphUrl();
  if (!url) {
    console.warn('[discover] No GRAPH_API_KEY set — cannot discover positions');
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: QUERY,
        variables: { owner: ownerAddress.toLowerCase() },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[discover] Subgraph returned ${res.status}`);
      return [];
    }

    const json = await res.json();

    if (json.errors?.length) {
      console.warn('[discover] Subgraph errors:', json.errors[0].message);
      return [];
    }

    const positions = json.data?.positions ?? [];
    return positions.map((p: { tokenId: string }) => ({ tokenId: p.tokenId }));
  } catch (err: any) {
    console.warn('[discover] Failed:', err.message);
    return [];
  }
}
