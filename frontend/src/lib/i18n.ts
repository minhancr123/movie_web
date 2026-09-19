'use client';

import React from 'react';

/**
 * Technical terms mapping based on environment.
 * In production, we hide specific provider names and internal stages.
 */
export const getResolveStageLabels = (isProduction = false): Record<string, string> => {
  if (isProduction) {
    return {
      detail: 'Đang chuẩn bị dữ liệu',
      sources: 'Đang tìm kiếm nguồn phát',
      rank: 'Đang tối ưu chất lượng',
      reuse: 'Đang tải lại phiên làm việc',
      prepare: 'Đang khởi tạo kết nối an toàn',
      link: 'Đang lấy đường dẫn phim',
      probe: 'Đang kiểm tra chất lượng video',
      remux: 'Đang chuyển đổi định dạng phù hợp',
      buffer: 'Đang tải những giây đầu',
      warm: 'Đang đệm dữ liệu bổ sung',
      published: 'Phim đã sẵn sàng',
    };
  }
  
  return {
    detail: 'Đang lấy thông tin phim',
    sources: 'Đang tìm nguồn chiếu',
    rank: 'Đang chấm điểm nguồn',
    reuse: 'Đang kiểm tra phiên cũ',
    prepare: 'Đang chuẩn bị link TorBox',
    link: 'Đang lấy link tải',
    probe: 'Đang đọc thông tin file (Probe)',
    remux: 'Đang khởi động luồng (Remux)',
    buffer: 'Đang đệm những giây đầu',
    warm: 'Đang đệm thêm',
    published: 'Có sẵn bản hoàn chỉnh',
  };
};

export const getFriendlyErrorMessage = (error: string, isProduction = false): string => {
  if (!isProduction) return error;

  // Map technical error strings to user-friendly ones in production
  const errorMap: Record<string, string> = {
    'API endpoint not found': 'Nội dung không tồn tại hoặc đã bị gỡ bỏ.',
    'Internal Server Error': 'Hệ thống đang bận, vui lòng thử lại sau giây lát.',
    'resolving failed': 'Không thể kết nối tới nguồn phát này. Vui lòng thử nguồn khác.',
    'Network Error': 'Lỗi kết nối mạng, vui lòng kiểm tra lại internet.',
    'Not Found': 'Không tìm thấy dữ liệu yêu cầu.',
  };

  for (const [key, value] of Object.entries(errorMap)) {
    if (error.toLowerCase().includes(key.toLowerCase())) return value;
  }

  return 'Đã có lỗi xảy ra. Vui lòng tải lại trang.';
};
