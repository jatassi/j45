import type { JSX, ReactNode } from 'react'

import { focusLabel } from '@j45/domain'
import { PlusIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Wordmark } from '@/components/wordmark'
import { GlassCard } from '@/glass/glass-card'

const COLOR_TOKENS =
  'background foreground card card-2 card-foreground popover popover-foreground primary primary-foreground secondary secondary-foreground muted muted-foreground accent accent-foreground destructive border input ring chart-1 chart-2 chart-3 chart-4 chart-5 sidebar sidebar-foreground sidebar-primary sidebar-primary-foreground sidebar-accent sidebar-accent-foreground sidebar-border sidebar-ring hue-cardio hue-strength hue-hybrid hue-work hue-rest'.split(
    ' ',
  )

const RADIUS_SCALE = ['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'] as const
// prettier-ignore
const MOTION = [['--duration-state', '150ms'], ['--duration-enter', '250ms'], ['--ease-out', 'ease-out']] as const
const BTN_VARIANTS = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const
const BTN_SIZES = ['default', 'xs', 'sm', 'lg'] as const
const BTN_ICONS = ['icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const
const SPORT_BADGES = [
  ['cardio', focusLabel.cardio],
  ['strength', focusLabel.strength],
  ['hybrid', focusLabel.hybrid],
  ['work', 'Work'],
  ['rest', 'Rest'],
] as const
const COMBO_ITEMS = ['Burpee', 'Kettlebell swing', 'Row', 'Thruster'] as const

export function Section(props: {
  id: string
  title: string
  description?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section id={props.id} className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] text-eyebrow text-muted-foreground">{props.id}</p>
        <h2 className="font-heading text-xl font-semibold tracking-tight">{props.title}</h2>
        {props.description === undefined ? null : (
          <p className="text-sm text-muted-foreground">{props.description}</p>
        )}
      </header>
      {props.children}
    </section>
  )
}

export function Row(props: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] text-eyebrow text-muted-foreground">{props.label}</p>
      <div className="flex flex-wrap items-center gap-2">{props.children}</div>
    </div>
  )
}

export function ColorTokensSection(): JSX.Element {
  return (
    <Section id="color" title="Color tokens" description="Every :root colour custom property.">
      <GlassCard className="rounded-2xl" data-testid="design-glass-surface">
        <CardHeader>
          <CardTitle>Palette</CardTitle>
          <CardDescription>Live glass surface over the swatch grid.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {COLOR_TOKENS.map((token) => (
              <div key={token} className="flex flex-col gap-1.5" data-token={token}>
                <div
                  className="h-12 w-full rounded-md ring-1 ring-foreground/10"
                  style={{ backgroundColor: `var(--${token})` }}
                  aria-hidden
                />
                <span className="font-mono text-[11px] text-muted-foreground">--{token}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </GlassCard>
    </Section>
  )
}

export function TypeScaleSection(): JSX.Element {
  return (
    <Section id="type" title="Type scale" description="Recorded treatments from index.css.">
      <div className="flex flex-col gap-6 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <div>
          <p className="text-[10px] text-eyebrow text-muted-foreground">eyebrow</p>
          <p className="text-[11px] text-eyebrow">Session focus · cardio</p>
        </div>
        <div>
          <p className="text-[10px] text-eyebrow text-muted-foreground">body</p>
          <p className="text-sm leading-relaxed">Body copy at the app default — Geist Variable.</p>
        </div>
        <div>
          <p className="text-[10px] text-eyebrow text-muted-foreground">heading</p>
          <h3 className="font-heading text-2xl font-semibold tracking-tight">Heading treatment</h3>
        </div>
        <div>
          <p className="text-[10px] text-eyebrow text-muted-foreground">display</p>
          <p className="font-heading text-5xl font-black text-display">12:34</p>
        </div>
      </div>
    </Section>
  )
}

export function RadiusMotionSection(): JSX.Element {
  return (
    <Section id="radius-motion" title="Radius & motion">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
          <p className="text-[10px] text-eyebrow text-muted-foreground">--radius-*</p>
          <div className="flex flex-wrap items-end gap-3">
            {RADIUS_SCALE.map((step) => (
              <div key={step} className="flex flex-col items-center gap-1.5">
                <div
                  className="size-14 bg-primary/30 ring-1 ring-primary/40"
                  style={{ borderRadius: `var(--radius-${step})` }}
                />
                <span className="font-mono text-[11px] text-muted-foreground">{step}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
          <p className="text-[10px] text-eyebrow text-muted-foreground">motion language</p>
          <ul className="flex flex-col gap-2">
            {MOTION.map(([name, value]) => (
              <li key={name} className="flex justify-between gap-4 font-mono text-sm">
                <span className="text-muted-foreground">{name}</span>
                <span>{value}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  )
}

export function WordmarkSection(): JSX.Element {
  return (
    <Section id="wordmark" title="Wordmark">
      <Card className="w-fit">
        <CardContent className="flex items-center gap-4 pt-(--card-spacing)">
          <Wordmark />
          <span className="text-sm text-muted-foreground">variant=default</span>
        </CardContent>
      </Card>
    </Section>
  )
}

export function SportBadgesSection(): JSX.Element {
  return (
    <Section
      id="sport-badges"
      title="Sport hues"
      description="Domain labels for focus; Work/Rest plain."
    >
      <div className="flex flex-wrap gap-2">
        {SPORT_BADGES.map(([variant, label]) =>
          // prettier-ignore
          <Badge key={variant} variant={variant}>{label}</Badge>,
        )}
      </div>
    </Section>
  )
}

function ButtonVariantRows(): JSX.Element {
  return (
    <>
      <Row label="button variants">
        {BTN_VARIANTS.map((v) =>
          // prettier-ignore
          <Button key={v} type="button" variant={v}>{v}</Button>,
        )}
      </Row>
      <Row label="button sizes">
        {BTN_SIZES.map((s) =>
          // prettier-ignore
          <Button key={s} type="button" size={s}>{s}</Button>,
        )}
        {BTN_ICONS.map((s) =>
          // prettier-ignore
          <Button key={s} type="button" size={s} aria-label={s}><PlusIcon /></Button>,
        )}
      </Row>
    </>
  )
}

function CardSamples(): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Card default</CardTitle>
          <CardDescription>size=default</CardDescription>
          <CardAction>
            {/* prettier-ignore */}
            <Button type="button" size="xs" variant="ghost">Action</Button>
          </CardAction>
        </CardHeader>
        <CardContent>Opaque content card.</CardContent>
        <CardFooter className="border-t">Footer</CardFooter>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Card sm</CardTitle>
          <CardDescription>size=sm</CardDescription>
        </CardHeader>
        <CardContent>Compact spacing.</CardContent>
      </Card>
    </div>
  )
}

export function ButtonCardSpinnerSection(): JSX.Element {
  return (
    <Section id="button-card-spinner" title="Button · Card · Spinner">
      <div className="flex flex-col gap-6">
        <ButtonVariantRows />
        <CardSamples />
        <Row label="spinner">
          <Spinner />
          <Spinner className="size-6" />
        </Row>
      </div>
    </Section>
  )
}

function FormsFields(): JSX.Element {
  return (
    <FieldSet>
      <FieldLegend>Field orientations</FieldLegend>
      <FieldGroup>
        <Field orientation="vertical">
          <FieldLabel htmlFor="design-name">Name (vertical)</FieldLabel>
          <Input id="design-name" placeholder="Workout name" />
          <FieldDescription>Default vertical field stack.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="design-rounds">Rounds (horizontal)</FieldLabel>
          <Input id="design-rounds" type="number" defaultValue={3} className="max-w-24" />
        </Field>
        <Field orientation="vertical" data-invalid>
          <FieldLabel htmlFor="design-invalid">Invalid</FieldLabel>
          <Input id="design-invalid" aria-invalid defaultValue="" placeholder="Required" />
          <FieldError>This field is required.</FieldError>
        </Field>
      </FieldGroup>
    </FieldSet>
  )
}

function FormsControls(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <Row label="label + checkbox">
        <div className="flex items-center gap-2">
          <Checkbox id="design-check" defaultChecked />
          <Label htmlFor="design-check">Include rest segments</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="design-check-off" />
          <Label htmlFor="design-check-off">Unchecked</Label>
        </div>
      </Row>
      <Row label="select">
        <Select defaultValue="laps" items={{ laps: 'Laps', sets: 'Sets' }}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="laps">Laps</SelectItem>
            <SelectItem value="sets">Sets</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="combobox">
        <Combobox items={[...COMBO_ITEMS]}>
          <ComboboxInput placeholder="Pick an exercise" className="w-64" />
          <ComboboxContent>
            <ComboboxEmpty>No matches</ComboboxEmpty>
            <ComboboxList>
              {(item: string) =>
                // prettier-ignore
                <ComboboxItem key={item} value={item}>{item}</ComboboxItem>
              }
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Row>
    </div>
  )
}

export function FormsSection(): JSX.Element {
  return (
    <Section id="forms" title="Forms">
      <div className="grid gap-8 lg:grid-cols-2">
        <FormsFields />
        <div className="flex flex-col gap-6">
          <FormsControls />
          <Row label="toggle-group">
            <ToggleGroup defaultValue={['cardio']} variant="default" size="default">
              <ToggleGroupItem value="cardio">{focusLabel.cardio}</ToggleGroupItem>
              <ToggleGroupItem value="strength">{focusLabel.strength}</ToggleGroupItem>
              <ToggleGroupItem value="hybrid">{focusLabel.hybrid}</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup defaultValue={['laps']} variant="outline" size="sm">
              <ToggleGroupItem value="laps">Laps</ToggleGroupItem>
              <ToggleGroupItem value="sets">Sets</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup defaultValue={['a']} variant="outline" size="lg">
              <ToggleGroupItem value="a">A</ToggleGroupItem>
              <ToggleGroupItem value="b">B</ToggleGroupItem>
            </ToggleGroup>
          </Row>
        </div>
      </div>
    </Section>
  )
}
