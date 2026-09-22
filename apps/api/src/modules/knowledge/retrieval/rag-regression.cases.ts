export const ragRegressionCases = [
  {
    question: '退款需要多久处理？',
    expectedAnswerTerms: ['退款', '3个工作日'],
    expectedDocumentId: 'refund-policy',
    content: '退款申请审核通过后，将在3个工作日内原路退回。',
  },
  {
    question: '发票开错了如何处理？',
    expectedAnswerTerms: ['作废', '重新开具'],
    expectedDocumentId: 'invoice-guide',
    content: '发票信息错误时，客服会先作废原发票，然后重新开具。',
  },
  {
    question: '人工客服工作时间是什么？',
    expectedAnswerTerms: ['09:00', '18:00'],
    expectedDocumentId: 'support-hours',
    content: '人工客服工作时间为周一至周五09:00至18:00。',
  },
] as const;
