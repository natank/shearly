export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly translationKey: string,
    readonly httpStatus: number,
  ) {
    super(code);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(translationKey = 'errors.validation') {
    super('VALIDATION', translationKey, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(translationKey = 'errors.notFound') {
    super('NOT_FOUND', translationKey, 404);
  }
}

export class ConflictError extends AppError {
  constructor(translationKey = 'errors.conflict') {
    super('CONFLICT', translationKey, 409);
  }
}

export class AuthorizationError extends AppError {
  constructor(translationKey = 'errors.unauthorized') {
    super('UNAUTHORIZED', translationKey, 403);
  }
}

export class PaymentError extends AppError {
  constructor(translationKey = 'errors.payment') {
    super('PAYMENT', translationKey, 402);
  }
}

export class ExternalServiceError extends AppError {
  constructor(translationKey = 'errors.external') {
    super('EXTERNAL_SERVICE', translationKey, 502);
  }
}

export function toErrorBody(error: AppError) {
  return {
    error: error.code,
    translationKey: error.translationKey,
  };
}
