import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  preprocessEmailBody,
  _setPdfParseForTest,
  type ContentType,
  type ExtractionMetadata,
} from '../candidate-extraction';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              isSubmission: true,
              firstName: 'John',
              lastName: 'Doe',
              email: 'john@example.com',
              phone: '+1-555-0100',
              skills: ['Boeing 737', 'A&P'],
              certifications: ['FAA A&P License'],
            }),
          },
        ],
        usage: { input_tokens: 50, output_tokens: 20 },
      }),
    },
  })),
}));

const mockPdfParse = vi.fn().mockResolvedValue({ text: 'John Doe\njohn@example.com\nBoeing 737 mechanic' });

describe('candidate-extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _setPdfParseForTest(mockPdfParse);
  });

  describe('preprocessEmailBody', () => {
    it('strips HTML tags and normalizes whitespace', () => {
      const result = preprocessEmailBody('<p>Hello <b>World</b></p>', 'Test Subject');
      expect(result).toContain('Subject: Test Subject');
      expect(result).toContain('Hello World');
      expect(result).not.toContain('<p>');
    });

    it('caps content at 10000 chars', () => {
      const longBody = 'x'.repeat(20_000);
      const result = preprocessEmailBody(longBody);
      expect(result.length).toBeLessThanOrEqual(10_000);
    });

    it('decodes HTML entities', () => {
      const result = preprocessEmailBody('A&amp;P License &nbsp; test');
      expect(result).toContain('A&P License');
    });
  });

  describe('extractCandidateFromDocument', () => {
    it('returns error for unsupported content type', async () => {
      const { extractCandidateFromDocument } = await import('../candidate-extraction');
      const result = await extractCandidateFromDocument(
        'test',
        'unknown_type' as ContentType,
        { source: 'test', tenantId: 'test' } as ExtractionMetadata
      );
      expect(result.extraction).toBeNull();
      expect(result.error).toContain('Unsupported content type');
    });

    it('returns error for PDF with string content', async () => {
      const { extractCandidateFromDocument } = await import('../candidate-extraction');
      const result = await extractCandidateFromDocument(
        'not a buffer',
        'pdf',
        { source: 'resume_upload', tenantId: 'test' }
      );
      expect(result.extraction).toBeNull();
      expect(result.error).toBe('PDF content must be a Buffer');
    });

    it('returns error for email_body with Buffer content', async () => {
      const { extractCandidateFromDocument } = await import('../candidate-extraction');
      const result = await extractCandidateFromDocument(
        Buffer.from('test'),
        'email_body',
        { source: 'email', tenantId: 'test' }
      );
      expect(result.extraction).toBeNull();
      expect(result.error).toBe('Email body content must be a string');
    });

    it('extracts candidate from email body with LLM', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      vi.resetModules();
      const mod = await import('../candidate-extraction');
      mod._resetClientForTest();
      const result = await mod.extractCandidateFromDocument(
        '<p>John Doe - john@example.com</p>',
        'email_body',
        { source: 'email', tenantId: 'test', subject: 'Candidate Submission' }
      );
      expect(result.extraction).not.toBeNull();
      expect(result.extraction?.firstName).toBe('John');
      expect(result.extraction?.lastName).toBe('Doe');
      expect(result.extraction?.source).toBe('email');
      expect(result.extraction?.extractionMethod).toBe('llm');
      delete process.env.ANTHROPIC_API_KEY;
    });

    it('extracts candidate from PDF buffer with LLM', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      vi.resetModules();
      const mod = await import('../candidate-extraction');
      mod._resetClientForTest();
      mod._setPdfParseForTest(mockPdfParse);
      const pdfBuffer = Buffer.from('fake pdf content');
      const result = await mod.extractCandidateFromDocument(
        pdfBuffer,
        'pdf',
        { source: 'resume_upload', tenantId: 'test', batchId: 'batch-1' }
      );
      expect(result.extraction).not.toBeNull();
      expect(result.extraction?.firstName).toBe('John');
      expect(result.extraction?.source).toBe('resume_upload');
      expect(result.extraction?.isSubmission).toBe(true);
      delete process.env.ANTHROPIC_API_KEY;
    });

    it('uses regex fallback for email when no API key', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      vi.resetModules();
      const mod = await import('../candidate-extraction');
      mod._resetClientForTest();
      const result = await mod.extractCandidateFromDocument(
        'First Name: Jane\nLast Name: Smith\nEmail: jane@test.com',
        'email_body',
        { source: 'email', tenantId: 'test' }
      );
      expect(result.extraction).not.toBeNull();
      expect(result.extraction?.firstName).toBe('Jane');
      expect(result.extraction?.lastName).toBe('Smith');
      expect(result.extraction?.extractionMethod).toBe('regex');
    });

    it('returns error for PDF when no API key', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      vi.resetModules();
      const mod = await import('../candidate-extraction');
      mod._resetClientForTest();
      mod._setPdfParseForTest(mockPdfParse);
      const result = await mod.extractCandidateFromDocument(
        Buffer.from('test'),
        'pdf',
        { source: 'resume_upload', tenantId: 'test' }
      );
      expect(result.extraction).toBeNull();
      expect(result.error).toContain('ANTHROPIC_API_KEY not configured');
    });
  });
});
