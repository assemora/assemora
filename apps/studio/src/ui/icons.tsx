/**
 * What a resource is drawn as (SPEC.md §58).
 *
 * The registry carries a *name* — `shopping-cart`, `utensils` — and this is the set
 * those names are looked up in. The glyphs live here rather than in the framework for
 * the reason Studio's own language does: they ship inside a pre-built artifact
 * (ADR-0027), and an application cannot add one to a bundle it did not build. So the
 * framework validates that a name is a name, and this decides what it looks like.
 *
 * A name that is not here is drawn as a document, which is what every resource in
 * Studio looked like before any of them could say otherwise. That is the whole
 * degradation story: an application naming an icon a newer Studio would know is a
 * project that reads slightly plainer, not one that breaks.
 *
 * The names are Lucide's own, so a person choosing one in an editor and a person
 * writing one in `resource(…, { icon })` are reading the same catalogue at lucide.dev.
 */
import {
  Bell,
  Bookmark,
  BookOpen,
  Briefcase,
  Building,
  CakeSlice,
  Calendar,
  ChartLine,
  CircleQuestionMark,
  ClipboardList,
  Coffee,
  Columns3,
  Contact,
  CreditCard,
  FileText,
  Flame,
  Folder,
  Gauge,
  Gift,
  Globe,
  Grid2x2,
  Heart,
  Image as ImageIcon,
  Images,
  Key,
  Layers,
  Leaf,
  Link,
  List,
  Mail,
  MapPin,
  Megaphone,
  MessageSquare,
  Music,
  Newspaper,
  NotebookPen,
  Package,
  PanelTop,
  Percent,
  Phone,
  Pizza,
  Quote,
  Receipt,
  Rows3,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Sun,
  Tag,
  TextAlignStart,
  Ticket,
  Truck,
  User,
  Users,
  Utensils,
  Video,
  Wrench,
} from 'lucide-react'
import type { ComponentType } from 'react'

type Glyph = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

/**
 * The set, in the order a picker offers it.
 *
 * Grouped the way the kinds picker is grouped, and for the same reason: sixty-one
 * glyphs in one grid is a wall somebody scrolls past rather than reads. A group is
 * presentation and is allowed to be a judgement call — what matters is that every name
 * in it is Lucide's.
 */
export const ICON_GROUPS: readonly {
  readonly label:
    | 'icons.group.content'
    | 'icons.group.people'
    | 'icons.group.shop'
    | 'icons.group.media'
    | 'icons.group.world'
    | 'icons.group.signals'
    | 'icons.group.structure'
  readonly names: readonly string[]
}[] = [
  {
    label: 'icons.group.content',
    names: [
      'file-text',
      'newspaper',
      'book-open',
      'notebook-pen',
      'quote',
      'message-square',
      'circle-question-mark',
      'clipboard-list',
      'text-align-start',
      'bookmark',
    ],
  },
  {
    label: 'icons.group.people',
    names: ['users', 'user', 'contact', 'briefcase', 'building', 'shield', 'key'],
  },
  {
    label: 'icons.group.shop',
    names: [
      'store',
      'shopping-cart',
      'shopping-bag',
      'package',
      'tag',
      'ticket',
      'percent',
      'credit-card',
      'receipt',
      'truck',
      'gift',
    ],
  },
  {
    label: 'icons.group.media',
    names: ['image', 'images', 'video', 'music', 'utensils', 'pizza', 'coffee', 'cake-slice'],
  },
  {
    label: 'icons.group.world',
    names: ['calendar', 'map-pin', 'globe', 'link', 'mail', 'phone', 'leaf', 'sun'],
  },
  {
    label: 'icons.group.signals',
    names: ['star', 'heart', 'bell', 'megaphone', 'sparkles', 'flame', 'chart-line', 'gauge'],
  },
  {
    label: 'icons.group.structure',
    names: [
      'folder',
      'layers',
      'panel-top',
      'rows-3',
      'columns-3',
      'list',
      'grid-2x2',
      'settings',
      'wrench',
    ],
  },
]

const GLYPHS: Readonly<Record<string, Glyph>> = {
  'file-text': FileText,
  newspaper: Newspaper,
  'book-open': BookOpen,
  'notebook-pen': NotebookPen,
  quote: Quote,
  'message-square': MessageSquare,
  'circle-question-mark': CircleQuestionMark,
  'clipboard-list': ClipboardList,
  'text-align-start': TextAlignStart,
  bookmark: Bookmark,
  users: Users,
  user: User,
  contact: Contact,
  briefcase: Briefcase,
  building: Building,
  shield: Shield,
  key: Key,
  store: Store,
  'shopping-cart': ShoppingCart,
  'shopping-bag': ShoppingBag,
  package: Package,
  tag: Tag,
  ticket: Ticket,
  percent: Percent,
  'credit-card': CreditCard,
  receipt: Receipt,
  truck: Truck,
  gift: Gift,
  image: ImageIcon,
  images: Images,
  video: Video,
  music: Music,
  utensils: Utensils,
  pizza: Pizza,
  coffee: Coffee,
  'cake-slice': CakeSlice,
  calendar: Calendar,
  'map-pin': MapPin,
  globe: Globe,
  link: Link,
  mail: Mail,
  phone: Phone,
  leaf: Leaf,
  sun: Sun,
  star: Star,
  heart: Heart,
  bell: Bell,
  megaphone: Megaphone,
  sparkles: Sparkles,
  flame: Flame,
  'chart-line': ChartLine,
  gauge: Gauge,
  folder: Folder,
  layers: Layers,
  'panel-top': PanelTop,
  'rows-3': Rows3,
  'columns-3': Columns3,
  list: List,
  'grid-2x2': Grid2x2,
  settings: Settings,
  wrench: Wrench,
}

/** Every name this build knows, which is what the picker offers and what a test counts. */
export const ICON_NAMES: readonly string[] = ICON_GROUPS.flatMap((group) => group.names)

/**
 * The glyph for a name, or the document every resource was drawn as before.
 *
 * Takes `undefined` as well as an unknown name, because those are the same state as far
 * as a sidebar is concerned: nobody said, so it is a resource.
 */
export const ResourceIcon = ({
  name,
  className = 'size-[18px]',
}: {
  name: string | undefined
  className?: string
}) => {
  const Glyph = (name === undefined ? undefined : GLYPHS[name]) ?? FileText

  return <Glyph aria-hidden className={className} />
}
