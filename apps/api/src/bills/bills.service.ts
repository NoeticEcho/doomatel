import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import { schema } from '@doomatel/db';
import { DatabaseService } from '../common/database.service.js';

export interface BillSearchInput {
  query?: string;
  number?: string;
  convocation?: number;
  statusCodes?: number[];
  committeeId?: number;
  introducedFrom?: string;
  introducedTo?: string;
  limit: number;
}

/**
 * Доступ к базе законопроектов.
 *
 * Корпус законопроектов общедоступен, поэтому проверка прав здесь не нужна;
 * ограничение — только по нагрузке.
 */
@Injectable()
export class BillsService {
  constructor(private readonly db: DatabaseService) {}

  async search(input: BillSearchInput) {
    const conditions = [];
    if (input.number) conditions.push(eq(schema.bill.number, input.number));
    if (input.convocation !== undefined) {
      conditions.push(eq(schema.bill.convocation, input.convocation));
    }
    if (input.statusCodes?.length) {
      conditions.push(inArray(schema.bill.statusCode, input.statusCodes));
    }
    if (input.committeeId !== undefined) {
      conditions.push(eq(schema.bill.responsibleCommitteeId, input.committeeId));
    }
    if (input.introducedFrom) {
      conditions.push(gte(schema.bill.introductionDate, input.introducedFrom));
    }
    if (input.introducedTo) {
      conditions.push(lte(schema.bill.introductionDate, input.introducedTo));
    }
    if (input.query) {
      // Полнотекстовый поиск с русской конфигурацией: без неё словоформы
      // не приводятся к одной основе и «образования» не найдёт «образование».
      conditions.push(
        sql`to_tsvector('russian', ${schema.bill.name}) @@ plainto_tsquery('russian', ${input.query})`,
      );
    }

    const rows = await this.db.drizzle
      .select({
        number: schema.bill.number,
        name: schema.bill.name,
        introductionDate: schema.bill.introductionDate,
        statusText: schema.bill.statusText,
        statusCode: schema.bill.statusCode,
        lastEventDate: schema.bill.lastEventDate,
        lastEventSolution: schema.bill.lastEventSolution,
        sozdUrl: schema.bill.sozdUrl,
        fzNumber: schema.bill.fzNumber,
        responsibleCommittee: schema.refCommittee.name,
      })
      .from(schema.bill)
      .leftJoin(
        schema.refCommittee,
        eq(schema.refCommittee.id, schema.bill.responsibleCommitteeId),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.bill.lastEventDate))
      .limit(input.limit);

    return { bills: rows, total: rows.length };
  }

  async get(number: string, includeDocuments: boolean) {
    const [bill] = await this.db.drizzle
      .select()
      .from(schema.bill)
      .where(eq(schema.bill.number, number))
      .limit(1);

    if (!bill) return { found: false as const };

    const events = await this.db.drizzle
      .select()
      .from(schema.billEvent)
      .where(eq(schema.billEvent.billNumber, number))
      .orderBy(asc(schema.billEvent.eventDate), asc(schema.billEvent.eventNum));

    const initiators = await this.db.drizzle
      .select({
        id: schema.subjectOfInitiative.id,
        kind: schema.subjectOfInitiative.kind,
        name: schema.subjectOfInitiative.name,
      })
      .from(schema.billInitiator)
      .innerJoin(
        schema.subjectOfInitiative,
        eq(schema.subjectOfInitiative.id, schema.billInitiator.subjectId),
      )
      .where(eq(schema.billInitiator.billNumber, number));

    const documents = includeDocuments
      ? await this.db.drizzle
          .select({
            title: schema.billDocument.title,
            docKind: schema.billDocument.docKind,
            docDate: schema.billDocument.docDate,
            eventNum: schema.billDocument.eventNum,
            format: schema.document.format,
            sha256: schema.document.sha256,
            extractStatus: schema.document.extractStatus,
            sourceUrl: schema.document.sourceUrl,
          })
          .from(schema.billDocument)
          .innerJoin(schema.document, eq(schema.document.sha256, schema.billDocument.documentSha))
          .where(eq(schema.billDocument.billNumber, number))
      : [];

    return { found: true as const, bill, events, initiators, documents };
  }

  /** Текст документа законопроекта — для работы агентов и редактора. */
  async documentText(sha256: string) {
    const [document] = await this.db.drizzle
      .select({
        sha256: schema.document.sha256,
        plainText: schema.document.plainText,
        format: schema.document.format,
        extractStatus: schema.document.extractStatus,
        sourceUrl: schema.document.sourceUrl,
      })
      .from(schema.document)
      .where(eq(schema.document.sha256, sha256))
      .limit(1);

    return document ?? null;
  }
}
