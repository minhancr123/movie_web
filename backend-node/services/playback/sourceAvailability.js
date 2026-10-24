/** Structured failures; a human-readable message must never drive retries. */
export const sourceListingFailure = (errors = []) => errors.length
  ? { status: 503, code: 'SOURCE_LIST_UNAVAILABLE', retryable: true,
      message: 'Dịch vụ nguồn đang phản hồi lỗi, vui lòng thử lại sau' }
  : { status: 404, code: 'SOURCE_NOT_FOUND', retryable: false,
      message: 'Phim này hiện chưa có nguồn phát trực tuyến hoặc chưa phát hành bản kỹ thuật số.' };

export const incompatibleSourcesFailure = {
  status: 422, code: 'NO_COMPATIBLE_SOURCE', retryable: false,
  message: 'Không có nguồn nào phát được trên thiết bị này',
};
