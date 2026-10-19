import type { ArticleSlug, CapabilitySlug, DocsReferenceSlug, GuideSlug } from '@/lib/docs-nav';
import { isCapabilitySlug } from '@/lib/docs-nav';

/** The keys each helper reads. A translator that accepts the whole dictionary satisfies this. */
type CapabilityTitles = (
  key:
    | 'capabilityPages.variants'
    | 'capabilityPages.assistant'
    | 'capabilityPages.editing'
    | 'capabilityPages.library',
) => string;

type CapabilityLeads = (
  key:
    | 'capabilityLead.variants'
    | 'capabilityLead.assistant'
    | 'capabilityLead.editing'
    | 'capabilityLead.library',
) => string;

type GuideTitles = (
  key:
    | 'guidePages.pipeline'
    | 'guidePages.layers'
    | 'guidePages.contracts'
    | 'guidePages.decisions'
    | 'guidePages.access',
) => string;

type GuideLeads = (
  key:
    | 'guideLead.pipeline'
    | 'guideLead.layers'
    | 'guideLead.contracts'
    | 'guideLead.decisions'
    | 'guideLead.access',
) => string;

type ReferenceTitles = (
  key:
    | 'referencePages.generation'
    | 'referencePages.editor'
    | 'referencePages.files'
    | 'referencePages.chats'
    | 'referencePages.runs'
    | 'referencePages.library'
    | 'referencePages.models'
    | 'referencePages.users'
    | 'referencePages.auth'
    | 'referencePages.health'
    | 'referencePages.schemas',
) => string;

export function capabilityTitle(t: CapabilityTitles, slug: CapabilitySlug): string {
  switch (slug) {
    case 'variants':
      return t('capabilityPages.variants');
    case 'assistant':
      return t('capabilityPages.assistant');
    case 'editing':
      return t('capabilityPages.editing');
    case 'library':
      return t('capabilityPages.library');
  }
}

export function capabilityLead(t: CapabilityLeads, slug: CapabilitySlug): string {
  switch (slug) {
    case 'variants':
      return t('capabilityLead.variants');
    case 'assistant':
      return t('capabilityLead.assistant');
    case 'editing':
      return t('capabilityLead.editing');
    case 'library':
      return t('capabilityLead.library');
  }
}

export function articleTitle(t: CapabilityTitles & GuideTitles, slug: ArticleSlug): string {
  return isCapabilitySlug(slug) ? capabilityTitle(t, slug) : guideTitle(t, slug);
}

export function guideTitle(t: GuideTitles, slug: GuideSlug): string {
  switch (slug) {
    case 'pipeline':
      return t('guidePages.pipeline');
    case 'layers':
      return t('guidePages.layers');
    case 'contracts':
      return t('guidePages.contracts');
    case 'decisions':
      return t('guidePages.decisions');
    case 'access':
      return t('guidePages.access');
  }
}

export function guideLead(t: GuideLeads, slug: GuideSlug): string {
  switch (slug) {
    case 'pipeline':
      return t('guideLead.pipeline');
    case 'layers':
      return t('guideLead.layers');
    case 'contracts':
      return t('guideLead.contracts');
    case 'decisions':
      return t('guideLead.decisions');
    case 'access':
      return t('guideLead.access');
  }
}

export function referenceTitle(t: ReferenceTitles, slug: DocsReferenceSlug): string {
  switch (slug) {
    case 'generation':
      return t('referencePages.generation');
    case 'editor':
      return t('referencePages.editor');
    case 'files':
      return t('referencePages.files');
    case 'chats':
      return t('referencePages.chats');
    case 'runs':
      return t('referencePages.runs');
    case 'library':
      return t('referencePages.library');
    case 'models':
      return t('referencePages.models');
    case 'users':
      return t('referencePages.users');
    case 'auth':
      return t('referencePages.auth');
    case 'health':
      return t('referencePages.health');
    case 'schemas':
      return t('referencePages.schemas');
  }
}
