import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import { InboxIcon, PlusIcon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { installBackdrop } from '@/glass/backdrop'

import {
  ButtonCardSpinnerSection,
  ColorTokensSection,
  FormsSection,
  RadiusMotionSection,
  Row,
  Section,
  SportBadgesSection,
  TypeScaleSection,
  WordmarkSection,
} from './sections'

const BADGE_VARIANTS = ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'] as const

function FeedbackEmpty(): JSX.Element {
  return (
    <Empty className="border border-dashed" data-testid="design-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>No workouts yet</EmptyTitle>
        <EmptyDescription>Create your first plan to get started.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" size="sm">
          <PlusIcon />
          Create workout
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function FeedbackAlerts(): JSX.Element {
  return (
    <>
      <Alert variant="destructive" data-testid="design-alert">
        <TriangleAlertIcon />
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>Could not load the library.</AlertDescription>
        <AlertAction>
          <Button type="button" variant="outline" size="sm">
            <RotateCcwIcon />
            Retry
          </Button>
        </AlertAction>
      </Alert>
      <Alert variant="default">
        <AlertTitle>Default alert</AlertTitle>
        <AlertDescription>Informational inline notice.</AlertDescription>
      </Alert>
    </>
  )
}

function FeedbackActions(): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="secondary"
        data-testid="design-toast-trigger"
        onClick={() => {
          toast.error('Command failed', { description: 'Could not save the workout.' })
        }}
      >
        Trigger toast
      </Button>
      <Progress value={62} data-testid="design-progress">
        <ProgressLabel>Generating</ProgressLabel>
        <ProgressValue />
      </Progress>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={<Button variant="destructive" data-testid="design-alert-dialog-trigger" />}
        >
          Delete workout
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workout?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The plan is removed from your library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false)
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function FeedbackSection(): JSX.Element {
  return (
    <Section
      id="feedback"
      title="Feedback states"
      description="Skeleton · Empty+CTA · Alert+retry · Sonner · Progress · AlertDialog."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-eyebrow text-muted-foreground">skeleton</p>
          <Skeleton className="h-24 w-full" data-testid="design-skeleton" />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-eyebrow text-muted-foreground">empty + cta</p>
          <FeedbackEmpty />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-eyebrow text-muted-foreground">alert + retry</p>
          <FeedbackAlerts />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-eyebrow text-muted-foreground">
            sonner · progress · confirm
          </p>
          <FeedbackActions />
        </div>
      </div>
    </Section>
  )
}

function OverlaysSection(): JSX.Element {
  return (
    <Section id="overlays" title="Overlays" description="Drawer and dialog triggers.">
      <div className="flex flex-wrap gap-3">
        <Dialog>
          <DialogTrigger render={<Button variant="outline" data-testid="design-dialog-trigger" />}>
            Open dialog
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dialog</DialogTitle>
              <DialogDescription>Glass-chrome dialog surface from the ui kit.</DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
        <Drawer>
          <DrawerTrigger render={<Button variant="outline" data-testid="design-drawer-trigger" />}>
            Open drawer
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Drawer</DrawerTitle>
              <DrawerDescription>Bottom sheet for phone-first pickers.</DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              <DrawerClose render={<Button variant="outline" />}>Close</DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </div>
    </Section>
  )
}

function DisplayMedia(): JSX.Element {
  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-[10px] text-eyebrow text-muted-foreground">tabs</p>
        <Tabs defaultValue="workouts">
          <TabsList variant="default">
            <TabsTrigger value="workouts">Workouts</TabsTrigger>
            <TabsTrigger value="exercises">Exercises</TabsTrigger>
          </TabsList>
          <TabsContent value="workouts">Workouts panel</TabsContent>
          <TabsContent value="exercises">Exercises panel</TabsContent>
        </Tabs>
        <Tabs defaultValue="one">
          <TabsList variant="line">
            <TabsTrigger value="one">Line one</TabsTrigger>
            <TabsTrigger value="two">Line two</TabsTrigger>
          </TabsList>
          <TabsContent value="one">Line variant panel</TabsContent>
          <TabsContent value="two">Second line panel</TabsContent>
        </Tabs>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-[10px] text-eyebrow text-muted-foreground">avatar</p>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar size="sm">
            <AvatarFallback>sm</AvatarFallback>
          </Avatar>
          <Avatar size="default">
            <AvatarFallback>JD</AvatarFallback>
            <AvatarBadge />
          </Avatar>
          <Avatar size="lg">
            <AvatarFallback>LG</AvatarFallback>
          </Avatar>
          <AvatarGroup>
            <Avatar>
              <AvatarFallback>A</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>B</AvatarFallback>
            </Avatar>
            <AvatarGroupCount>+3</AvatarGroupCount>
          </AvatarGroup>
        </div>
      </div>
    </>
  )
}

function DisplaySection(): JSX.Element {
  return (
    <Section id="display" title="Display">
      <div className="flex flex-col gap-8">
        <Row label="badge variants">
          {BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
        </Row>
        <DisplayMedia />
        <div className="flex flex-col gap-3">
          <p className="text-[10px] text-eyebrow text-muted-foreground">accordion</p>
          <Accordion>
            <AccordionItem value="one">
              <AccordionTrigger>What is a pod?</AccordionTrigger>
              <AccordionContent>
                A pod is a group of stations that share a work/rest prescription.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="two">
              <AccordionTrigger>What is a flow?</AccordionTrigger>
              <AccordionContent>A flow sequences pods as laps or sets.</AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-[10px] text-eyebrow text-muted-foreground">separator</p>
          <div className="flex flex-col gap-3">
            <p className="text-sm">Above horizontal</p>
            <Separator />
            <p className="text-sm">Below horizontal</p>
          </div>
          <div className="flex h-8 items-center gap-3">
            <span className="text-sm">Left</span>
            <Separator orientation="vertical" />
            <span className="text-sm">Right</span>
          </div>
        </div>
      </div>
    </Section>
  )
}

/**
 * `/design` — dev-only gallery: every token, every `ui/` component/variant,
 * sport-hue badges via domain labels, feedback-state patterns, and one live
 * `GlassCard` surface. Mounted outside `AuthGate` (see `app.tsx`).
 */
export function DesignPage(): JSX.Element {
  useEffect(() => {
    installBackdrop()
  }, [])

  return (
    <div className="relative z-0 mx-auto flex min-h-svh max-w-5xl flex-col gap-16 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-[11px] text-eyebrow text-muted-foreground">Design system</p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Gallery</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Token swatches, type scale, radius/motion, Wordmark, the full ui/ kit, sport hues, and
          feedback patterns. Not linked from production nav.
        </p>
      </header>
      <ColorTokensSection />
      <TypeScaleSection />
      <RadiusMotionSection />
      <WordmarkSection />
      <SportBadgesSection />
      <FeedbackSection />
      <ButtonCardSpinnerSection />
      <FormsSection />
      <OverlaysSection />
      <DisplaySection />
      <Toaster />
    </div>
  )
}

export default DesignPage
