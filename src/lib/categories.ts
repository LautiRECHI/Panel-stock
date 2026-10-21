import { createClient } from '@/lib/supabase/server'

export type Category = {
  id: string
  store_id: string
  parent_id: string | null
  name: string
  slug: string
  position: number
  created_at: string
  updated_at: string
}

export type CategoryNode = Category & { children: CategoryNode[] }

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50) || 'categoria'
}

export function buildCategoryTree(categories: Category[]): CategoryNode[] {
  const map = new Map<string, CategoryNode>()

  for (const cat of categories) {
    map.set(cat.id, { ...cat, children: [] })
  }

  const roots: CategoryNode[] = []

  for (const cat of categories) {
    const node = map.get(cat.id)!
    if (cat.parent_id && map.has(cat.parent_id)) {
      map.get(cat.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const byPos = (a: CategoryNode, b: CategoryNode) =>
    a.position - b.position || a.name.localeCompare(b.name, 'es')

  roots.sort(byPos)
  for (const root of roots) root.children.sort(byPos)

  return roots
}

export async function getCategories(storeId: string): Promise<Category[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('categories')
    .select('id, store_id, parent_id, name, slug, position, created_at, updated_at')
    .eq('store_id', storeId)
    .order('position', { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}
