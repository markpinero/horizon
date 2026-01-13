import { Component } from '@theme/component';
import { debounce } from '@theme/utilities';

/**
 * @typedef {Object} YotpoReview
 * @property {number} id - Review ID
 * @property {string} title - Review title
 * @property {string} content - Review content
 * @property {number} score - Star rating (1-5)
 * @property {string} user_reference - Reviewer identifier
 * @property {Object} user - User object
 * @property {string} user.display_name - Reviewer display name
 * @property {string} created_at - ISO date string
 * @property {number} votes_up - Number of helpful votes
 * @property {number} votes_down - Number of unhelpful votes
 * @property {boolean} verified_buyer - Whether reviewer is verified
 * @property {Array<{original_url: string, thumbnail_url: string}>} images_data - Review images
 * @property {string} [comment] - Store response
 */

/**
 * @typedef {Object} YotpoBottomline
 * @property {number} total_review - Total number of reviews
 * @property {number} average_score - Average star rating
 * @property {Object<string, number>} star_distribution - Count per star rating
 */

/**
 * @typedef {Object} YotpoPagination
 * @property {number} page - Current page
 * @property {number} per_page - Items per page
 * @property {number} total - Total items
 */

/**
 * @typedef {Object} YotpoResponse
 * @property {number} status - HTTP status
 * @property {Object} response - Response data
 * @property {YotpoBottomline} response.bottomline - Rating summary
 * @property {YotpoReview[]} response.reviews - Reviews array
 * @property {YotpoPagination} response.pagination - Pagination info
 */

/**
 * Yotpo Reviews Web Component
 * Displays product reviews fetched from Yotpo's API
 *
 * @extends {Component}
 */
export class YotpoReviews extends Component {
  /** @type {string[]} */
  requiredRefs = [];

  /** @type {AbortController | null} */
  #abortController = null;

  /** @type {YotpoBottomline | null} */
  #bottomline = null;

  /** @type {YotpoReview[]} */
  #reviews = [];

  /** @type {YotpoPagination | null} */
  #pagination = null;

  /** @type {string} */
  #currentSort = 'date';

  /** @type {string} */
  #currentDirection = 'desc';

  /** @type {number | null} */
  #currentStarFilter = null;

  /** @type {number} */
  #currentPage = 1;

  /** @type {number} */
  #perPage = 10;

  /** @type {boolean} */
  #isLoading = false;

  /** @type {boolean} */
  #showForm = false;

  /** @type {Set<number>} */
  #votedReviews = new Set();

  /**
   * Get the Yotpo app key from the element attribute
   * @returns {string}
   */
  get appKey() {
    return this.getAttribute('app-key') || '';
  }

  /**
   * Get the product ID from the element attribute
   * @returns {string}
   */
  get productId() {
    return this.getAttribute('product-id') || '';
  }

  /**
   * Get the product title from the element attribute
   * @returns {string}
   */
  get productTitle() {
    return this.getAttribute('product-title') || '';
  }

  /**
   * Get the product URL from the element attribute
   * @returns {string}
   */
  get productUrl() {
    return this.getAttribute('product-url') || window.location.href;
  }

  /**
   * Get the product image URL from the element attribute
   * @returns {string}
   */
  get productImageUrl() {
    return this.getAttribute('product-image-url') || '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.#loadVotedReviews();
    this.#fetchReviews();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController?.abort();
  }

  /**
   * Load voted reviews from localStorage
   */
  #loadVotedReviews() {
    try {
      const voted = localStorage.getItem('yotpo-voted-reviews');
      if (voted) {
        this.#votedReviews = new Set(JSON.parse(voted));
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  /**
   * Save voted reviews to localStorage
   */
  #saveVotedReviews() {
    try {
      localStorage.setItem('yotpo-voted-reviews', JSON.stringify([...this.#votedReviews]));
    } catch {
      // Ignore localStorage errors
    }
  }

  /**
   * Build the API URL with current parameters
   * @returns {string}
   */
  #buildApiUrl() {
    const baseUrl = `https://api-cdn.yotpo.com/v1/widget/${this.appKey}/products/${this.productId}/reviews.json`;
    const params = new URLSearchParams({
      per_page: String(this.#perPage),
      page: String(this.#currentPage),
      sort: this.#currentSort,
      direction: this.#currentDirection,
    });

    if (this.#currentStarFilter !== null) {
      params.set('star', String(this.#currentStarFilter));
    }

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Fetch reviews from the Yotpo API
   */
  async #fetchReviews() {
    if (!this.appKey || !this.productId) {
      this.#renderError('Missing app-key or product-id attribute');
      return;
    }

    this.#abortController?.abort();
    this.#abortController = new AbortController();

    this.#isLoading = true;
    this.#render();

    try {
      const response = await fetch(this.#buildApiUrl(), {
        signal: this.#abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      /** @type {YotpoResponse} */
      const data = await response.json();

      if (data.status && data.status !== 200) {
        throw new Error(`API error: ${data.status}`);
      }

      this.#bottomline = data.response?.bottomline || null;
      this.#reviews = data.response?.reviews || [];
      this.#pagination = data.response?.pagination || null;
      this.#isLoading = false;
      this.#render();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      this.#isLoading = false;
      this.#renderError(error instanceof Error ? error.message : 'Failed to load reviews');
    }
  }

  /**
   * Render an error message
   * @param {string} message
   */
  #renderError(message) {
    this.innerHTML = `
      <div class="yotpo-reviews__error">
        <p>${this.#escapeHtml(message)}</p>
        <button class="yotpo-reviews__retry-btn" on:click="/retryFetch">Try Again</button>
      </div>
    `;
  }

  /**
   * Retry fetching reviews
   */
  retryFetch() {
    this.#fetchReviews();
  }

  /**
   * Main render function
   */
  #render() {
    const html = `
      <div class="yotpo-reviews">
        ${this.#renderHeader()}
        ${this.#isLoading ? this.#renderLoading() : ''}
        ${!this.#isLoading && this.#showForm ? this.#renderReviewForm() : ''}
        ${!this.#isLoading && !this.#showForm ? this.#renderContent() : ''}
      </div>
    `;
    this.innerHTML = html;
  }

  /**
   * Render the header section
   * @returns {string}
   */
  #renderHeader() {
    const totalReviews = this.#bottomline?.total_review || 0;
    const averageScore = this.#bottomline?.average_score || 0;

    return `
      <div class="yotpo-reviews__header">
        <div class="yotpo-reviews__summary">
          <div class="yotpo-reviews__average">
            <span class="yotpo-reviews__average-score">${averageScore.toFixed(1)}</span>
            <div class="yotpo-reviews__average-stars">
              ${this.#renderStars(averageScore)}
            </div>
            <span class="yotpo-reviews__total-count">${totalReviews} ${totalReviews === 1 ? 'Review' : 'Reviews'}</span>
          </div>
          ${this.#renderHistogram()}
        </div>
        <button class="yotpo-reviews__write-btn" on:click="/toggleForm">
          ${this.#showForm ? 'Cancel' : 'Write a Review'}
        </button>
      </div>
    `;
  }

  /**
   * Render star rating histogram
   * @returns {string}
   */
  #renderHistogram() {
    if (!this.#bottomline?.star_distribution) return '';

    const distribution = this.#bottomline.star_distribution;
    const total = this.#bottomline.total_review || 1;

    return `
      <div class="yotpo-reviews__histogram">
        ${[5, 4, 3, 2, 1]
          .map((star) => {
            const count = distribution[String(star)] || 0;
            const percentage = (count / total) * 100;
            const isActive = this.#currentStarFilter === star;

            return `
            <button
              class="yotpo-reviews__histogram-row ${isActive ? 'yotpo-reviews__histogram-row--active' : ''}"
              on:click="/filterByStar?star=${star}"
              aria-label="Filter by ${star} star reviews"
            >
              <span class="yotpo-reviews__histogram-label">${star} star</span>
              <div class="yotpo-reviews__histogram-bar">
                <div class="yotpo-reviews__histogram-fill" style="width: ${percentage}%"></div>
              </div>
              <span class="yotpo-reviews__histogram-count">${count}</span>
            </button>
          `;
          })
          .join('')}
        ${
          this.#currentStarFilter !== null
            ? `
          <button class="yotpo-reviews__clear-filter" on:click="/clearStarFilter">
            Clear filter
          </button>
        `
            : ''
        }
      </div>
    `;
  }

  /**
   * Render stars for a given rating
   * @param {number} rating
   * @param {string} [size='medium']
   * @returns {string}
   */
  #renderStars(rating, size = 'medium') {
    const fullStars = Math.floor(rating);
    const hasHalf = rating - fullStars >= 0.3 && rating - fullStars <= 0.7;
    const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0) - (rating - fullStars > 0.7 ? 1 : 0);
    const extraFull = rating - fullStars > 0.7 ? 1 : 0;

    const starSvg = `<svg viewBox="0 0 32 32" class="yotpo-reviews__star yotpo-reviews__star--${size}"><path d="M31.547 12a.848.848 0 00-.677-.577l-9.427-1.376-4.224-8.532a.847.847 0 00-1.516 0l-4.218 8.534-9.427 1.355a.847.847 0 00-.467 1.467l6.823 6.664-1.612 9.375a.847.847 0 001.23.893l8.428-4.434 8.432 4.432a.847.847 0 001.229-.894l-1.615-9.373 6.822-6.665a.845.845 0 00.214-.869z"/></svg>`;

    return `
      <div class="yotpo-reviews__stars" aria-label="Rating: ${rating.toFixed(1)} out of 5 stars">
        ${starSvg.repeat(fullStars + extraFull).replace(/yotpo-reviews__star--/g, 'yotpo-reviews__star--filled yotpo-reviews__star--')}
        ${hasHalf ? starSvg.replace('yotpo-reviews__star--', 'yotpo-reviews__star--half yotpo-reviews__star--') : ''}
        ${starSvg.repeat(Math.max(0, emptyStars - extraFull)).replace(/yotpo-reviews__star--/g, 'yotpo-reviews__star--empty yotpo-reviews__star--')}
      </div>
    `;
  }

  /**
   * Render loading state
   * @returns {string}
   */
  #renderLoading() {
    return `
      <div class="yotpo-reviews__loading">
        <div class="yotpo-reviews__spinner"></div>
        <p>Loading reviews...</p>
      </div>
    `;
  }

  /**
   * Render the review form
   * @returns {string}
   */
  #renderReviewForm() {
    return `
      <form class="yotpo-reviews__form" on:submit="/submitReview">
        <h3 class="yotpo-reviews__form-title">Write a Review</h3>

        <div class="yotpo-reviews__form-field">
          <label class="yotpo-reviews__form-label">Rating *</label>
          <div class="yotpo-reviews__form-rating" ref="formRating">
            ${[1, 2, 3, 4, 5]
              .map(
                (star) => `
              <button
                type="button"
                class="yotpo-reviews__form-star"
                data-rating="${star}"
                on:click="/setFormRating?rating=${star}"
                aria-label="Rate ${star} stars"
              >
                <svg viewBox="0 0 32 32"><path d="M31.547 12a.848.848 0 00-.677-.577l-9.427-1.376-4.224-8.532a.847.847 0 00-1.516 0l-4.218 8.534-9.427 1.355a.847.847 0 00-.467 1.467l6.823 6.664-1.612 9.375a.847.847 0 001.23.893l8.428-4.434 8.432 4.432a.847.847 0 001.229-.894l-1.615-9.373 6.822-6.665a.845.845 0 00.214-.869z"/></svg>
              </button>
            `
              )
              .join('')}
          </div>
          <input type="hidden" name="score" ref="formScoreInput" required>
        </div>

        <div class="yotpo-reviews__form-field">
          <label class="yotpo-reviews__form-label" for="yotpo-review-title">Review Title *</label>
          <input
            type="text"
            id="yotpo-review-title"
            name="title"
            class="yotpo-reviews__form-input"
            placeholder="Summarize your experience"
            required
            maxlength="150"
          >
        </div>

        <div class="yotpo-reviews__form-field">
          <label class="yotpo-reviews__form-label" for="yotpo-review-content">Review *</label>
          <textarea
            id="yotpo-review-content"
            name="content"
            class="yotpo-reviews__form-textarea"
            placeholder="Share your experience with this product"
            required
            rows="5"
            maxlength="5000"
          ></textarea>
        </div>

        <div class="yotpo-reviews__form-row">
          <div class="yotpo-reviews__form-field yotpo-reviews__form-field--half">
            <label class="yotpo-reviews__form-label" for="yotpo-review-name">Name *</label>
            <input
              type="text"
              id="yotpo-review-name"
              name="display_name"
              class="yotpo-reviews__form-input"
              placeholder="Your name"
              required
              maxlength="100"
            >
          </div>

          <div class="yotpo-reviews__form-field yotpo-reviews__form-field--half">
            <label class="yotpo-reviews__form-label" for="yotpo-review-email">Email *</label>
            <input
              type="email"
              id="yotpo-review-email"
              name="email"
              class="yotpo-reviews__form-input"
              placeholder="your@email.com"
              required
            >
          </div>
        </div>

        <div class="yotpo-reviews__form-actions">
          <button type="button" class="yotpo-reviews__form-cancel" on:click="/toggleForm">
            Cancel
          </button>
          <button type="submit" class="yotpo-reviews__form-submit" ref="formSubmitBtn">
            Submit Review
          </button>
        </div>

        <div class="yotpo-reviews__form-message" ref="formMessage" hidden></div>
      </form>
    `;
  }

  /**
   * Set the form rating
   * @param {{ rating: number }} data
   */
  setFormRating(data) {
    const rating = data.rating;
    const ratingContainer = this.querySelector('[ref="formRating"]');
    const scoreInput = /** @type {HTMLInputElement | null} */ (this.querySelector('[ref="formScoreInput"]'));

    if (!ratingContainer || !scoreInput) return;

    scoreInput.value = String(rating);

    const stars = ratingContainer.querySelectorAll('.yotpo-reviews__form-star');
    stars.forEach((star, index) => {
      if (index < rating) {
        star.classList.add('yotpo-reviews__form-star--filled');
      } else {
        star.classList.remove('yotpo-reviews__form-star--filled');
      }
    });
  }

  /**
   * Submit the review form
   * @param {Event} event
   */
  async submitReview(event) {
    event.preventDefault();

    const form = /** @type {HTMLFormElement | null} */ (event.target);
    if (!form) return;

    const formData = new FormData(form);
    const submitBtn = /** @type {HTMLButtonElement | null} */ (this.querySelector('[ref="formSubmitBtn"]'));
    const messageEl = this.querySelector('[ref="formMessage"]');

    if (!formData.get('score')) {
      this.#showFormMessage('Please select a star rating', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }

    try {
      const response = await fetch('https://api.yotpo.com/v1/widget/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appkey: this.appKey,
          domain: window.location.origin,
          sku: this.productId,
          product_title: this.productTitle,
          product_url: this.productUrl,
          product_image_url: this.productImageUrl,
          display_name: formData.get('display_name'),
          email: formData.get('email'),
          review_content: formData.get('content'),
          review_title: formData.get('title'),
          review_score: Number(formData.get('score')),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit review');
      }

      this.#showFormMessage('Thank you! Your review has been submitted and is pending approval.', 'success');

      // Reset form and hide after delay
      setTimeout(() => {
        this.#showForm = false;
        this.#render();
      }, 3000);
    } catch (error) {
      this.#showFormMessage('Failed to submit review. Please try again.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Review';
      }
    }
  }

  /**
   * Show a form message
   * @param {string} message
   * @param {'success' | 'error'} type
   */
  #showFormMessage(message, type) {
    const messageEl = this.querySelector('[ref="formMessage"]');
    if (!messageEl) return;

    messageEl.textContent = message;
    messageEl.className = `yotpo-reviews__form-message yotpo-reviews__form-message--${type}`;
    messageEl.removeAttribute('hidden');
  }

  /**
   * Toggle the review form visibility
   */
  toggleForm() {
    this.#showForm = !this.#showForm;
    this.#render();
  }

  /**
   * Render the main content (filters, reviews, pagination)
   * @returns {string}
   */
  #renderContent() {
    if (!this.#reviews.length && !this.#currentStarFilter) {
      return `
        <div class="yotpo-reviews__empty">
          <p>No reviews yet. Be the first to write a review!</p>
        </div>
      `;
    }

    return `
      <div class="yotpo-reviews__content">
        ${this.#renderControls()}
        ${this.#renderReviewsList()}
        ${this.#renderPagination()}
      </div>
    `;
  }

  /**
   * Render sorting and filter controls
   * @returns {string}
   */
  #renderControls() {
    return `
      <div class="yotpo-reviews__controls">
        <div class="yotpo-reviews__sort">
          <label for="yotpo-sort" class="yotpo-reviews__sort-label">Sort by:</label>
          <select id="yotpo-sort" class="yotpo-reviews__sort-select" on:change="/handleSort">
            <option value="date-desc" ${this.#currentSort === 'date' && this.#currentDirection === 'desc' ? 'selected' : ''}>
              Most Recent
            </option>
            <option value="date-asc" ${this.#currentSort === 'date' && this.#currentDirection === 'asc' ? 'selected' : ''}>
              Oldest First
            </option>
            <option value="score-desc" ${this.#currentSort === 'score' && this.#currentDirection === 'desc' ? 'selected' : ''}>
              Highest Rated
            </option>
            <option value="score-asc" ${this.#currentSort === 'score' && this.#currentDirection === 'asc' ? 'selected' : ''}>
              Lowest Rated
            </option>
            <option value="votes_up-desc" ${this.#currentSort === 'votes_up' && this.#currentDirection === 'desc' ? 'selected' : ''}>
              Most Helpful
            </option>
          </select>
        </div>

        ${
          this.#pagination
            ? `
          <span class="yotpo-reviews__showing">
            Showing ${Math.min((this.#currentPage - 1) * this.#perPage + 1, this.#pagination.total)}-${Math.min(this.#currentPage * this.#perPage, this.#pagination.total)} of ${this.#pagination.total}
          </span>
        `
            : ''
        }
      </div>
    `;
  }

  /**
   * Handle sort selection change
   * @param {Event} event
   */
  handleSort(event) {
    const select = /** @type {HTMLSelectElement | null} */ (event.target);
    if (!select) return;

    const [sort, direction] = select.value.split('-');
    this.#currentSort = sort;
    this.#currentDirection = direction;
    this.#currentPage = 1;
    this.#fetchReviews();
  }

  /**
   * Filter reviews by star rating
   * @param {{ star: number }} data
   */
  filterByStar(data) {
    if (this.#currentStarFilter === data.star) {
      this.#currentStarFilter = null;
    } else {
      this.#currentStarFilter = data.star;
    }
    this.#currentPage = 1;
    this.#fetchReviews();
  }

  /**
   * Clear the star filter
   */
  clearStarFilter() {
    this.#currentStarFilter = null;
    this.#currentPage = 1;
    this.#fetchReviews();
  }

  /**
   * Render the list of reviews
   * @returns {string}
   */
  #renderReviewsList() {
    if (!this.#reviews.length) {
      return `
        <div class="yotpo-reviews__no-results">
          <p>No reviews match your filter. <button class="yotpo-reviews__link-btn" on:click="/clearStarFilter">Clear filter</button></p>
        </div>
      `;
    }

    return `
      <div class="yotpo-reviews__list">
        ${this.#reviews.map((review) => this.#renderReview(review)).join('')}
      </div>
    `;
  }

  /**
   * Render a single review
   * @param {YotpoReview} review
   * @returns {string}
   */
  #renderReview(review) {
    const date = new Date(review.created_at);
    const formattedDate = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const hasVoted = this.#votedReviews.has(review.id);

    return `
      <article class="yotpo-reviews__review" data-review-id="${review.id}">
        <header class="yotpo-reviews__review-header">
          <div class="yotpo-reviews__review-meta">
            <span class="yotpo-reviews__reviewer-name">${this.#escapeHtml(review.user?.display_name || 'Anonymous')}</span>
            ${review.verified_buyer ? '<span class="yotpo-reviews__verified-badge">Verified Buyer</span>' : ''}
            <time class="yotpo-reviews__review-date" datetime="${review.created_at}">${formattedDate}</time>
          </div>
          <div class="yotpo-reviews__review-rating">
            ${this.#renderStars(review.score, 'small')}
          </div>
        </header>

        ${review.title ? `<h4 class="yotpo-reviews__review-title">${this.#escapeHtml(review.title)}</h4>` : ''}

        <div class="yotpo-reviews__review-content">
          <p>${this.#escapeHtml(review.content)}</p>
        </div>

        ${this.#renderReviewImages(review)}

        ${review.comment ? this.#renderStoreResponse(review.comment) : ''}

        <footer class="yotpo-reviews__review-footer">
          <span class="yotpo-reviews__helpful-label">Was this helpful?</span>
          <div class="yotpo-reviews__vote-buttons">
            <button
              class="yotpo-reviews__vote-btn yotpo-reviews__vote-btn--up ${hasVoted ? 'yotpo-reviews__vote-btn--disabled' : ''}"
              on:click="/voteHelpful?reviewId=${review.id}&vote=up"
              ${hasVoted ? 'disabled' : ''}
              aria-label="Yes, this review was helpful"
            >
              <svg viewBox="0 0 24 24" class="yotpo-reviews__vote-icon"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>
              <span class="yotpo-reviews__vote-count">${review.votes_up || 0}</span>
            </button>
            <button
              class="yotpo-reviews__vote-btn yotpo-reviews__vote-btn--down ${hasVoted ? 'yotpo-reviews__vote-btn--disabled' : ''}"
              on:click="/voteHelpful?reviewId=${review.id}&vote=down"
              ${hasVoted ? 'disabled' : ''}
              aria-label="No, this review was not helpful"
            >
              <svg viewBox="0 0 24 24" class="yotpo-reviews__vote-icon"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>
              <span class="yotpo-reviews__vote-count">${review.votes_down || 0}</span>
            </button>
          </div>
        </footer>
      </article>
    `;
  }

  /**
   * Render review images
   * @param {YotpoReview} review
   * @returns {string}
   */
  #renderReviewImages(review) {
    if (!review.images_data?.length) return '';

    return `
      <div class="yotpo-reviews__review-images">
        ${review.images_data
          .map(
            (image, index) => `
          <button
            class="yotpo-reviews__review-image-btn"
            on:click="/openImageModal?reviewId=${review.id}&imageIndex=${index}"
            aria-label="View image ${index + 1}"
          >
            <img
              src="${this.#escapeHtml(image.thumbnail_url || image.original_url)}"
              alt="Review image ${index + 1}"
              class="yotpo-reviews__review-image"
              loading="lazy"
            >
          </button>
        `
          )
          .join('')}
      </div>
    `;
  }

  /**
   * Render store response to a review
   * @param {string} comment
   * @returns {string}
   */
  #renderStoreResponse(comment) {
    return `
      <div class="yotpo-reviews__store-response">
        <div class="yotpo-reviews__store-response-header">
          <svg viewBox="0 0 24 24" class="yotpo-reviews__store-icon"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
          <span>Store Response</span>
        </div>
        <p>${this.#escapeHtml(comment)}</p>
      </div>
    `;
  }

  /**
   * Open image modal
   * @param {{ reviewId: number, imageIndex: number }} data
   */
  openImageModal(data) {
    const review = this.#reviews.find((r) => r.id === data.reviewId);
    if (!review?.images_data?.[data.imageIndex]) return;

    const image = review.images_data[data.imageIndex];

    // Create a simple modal
    const modal = document.createElement('div');
    modal.className = 'yotpo-reviews__modal';
    modal.innerHTML = `
      <div class="yotpo-reviews__modal-backdrop" on:click="/closeImageModal"></div>
      <div class="yotpo-reviews__modal-content">
        <button class="yotpo-reviews__modal-close" on:click="/closeImageModal" aria-label="Close modal">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
        <img src="${this.#escapeHtml(image.original_url)}" alt="Review image" class="yotpo-reviews__modal-image">
      </div>
    `;

    this.appendChild(modal);

    // Handle escape key
    const handleEscape = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') {
        this.closeImageModal();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  /**
   * Close image modal
   */
  closeImageModal() {
    const modal = this.querySelector('.yotpo-reviews__modal');
    modal?.remove();
  }

  /**
   * Vote on a review's helpfulness
   * @param {{ reviewId: number, vote: 'up' | 'down' }} data
   */
  async voteHelpful(data) {
    if (this.#votedReviews.has(data.reviewId)) return;

    // Optimistically update UI
    this.#votedReviews.add(data.reviewId);
    this.#saveVotedReviews();

    const review = this.#reviews.find((r) => r.id === data.reviewId);
    if (review) {
      if (data.vote === 'up') {
        review.votes_up = (review.votes_up || 0) + 1;
      } else {
        review.votes_down = (review.votes_down || 0) + 1;
      }
    }

    this.#render();

    // Send vote to Yotpo API (fire and forget)
    try {
      await fetch(`https://api.yotpo.com/reviews/${data.reviewId}/vote/${data.vote}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appkey: this.appKey,
        }),
      });
    } catch {
      // Vote failed, but we keep the optimistic update
    }
  }

  /**
   * Render pagination controls
   * @returns {string}
   */
  #renderPagination() {
    if (!this.#pagination || this.#pagination.total <= this.#perPage) return '';

    const totalPages = Math.ceil(this.#pagination.total / this.#perPage);
    const currentPage = this.#currentPage;

    // Generate page numbers to show
    const pages = this.#generatePageNumbers(currentPage, totalPages);

    return `
      <nav class="yotpo-reviews__pagination" aria-label="Reviews pagination">
        <button
          class="yotpo-reviews__page-btn yotpo-reviews__page-btn--prev"
          on:click="/goToPage?page=${currentPage - 1}"
          ${currentPage === 1 ? 'disabled' : ''}
          aria-label="Previous page"
        >
          <svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          <span>Previous</span>
        </button>

        <div class="yotpo-reviews__page-numbers">
          ${pages
            .map((page) => {
              if (page === '...') {
                return '<span class="yotpo-reviews__page-ellipsis">...</span>';
              }
              const pageNum = Number(page);
              return `
              <button
                class="yotpo-reviews__page-btn ${pageNum === currentPage ? 'yotpo-reviews__page-btn--active' : ''}"
                on:click="/goToPage?page=${pageNum}"
                ${pageNum === currentPage ? 'aria-current="page"' : ''}
              >
                ${pageNum}
              </button>
            `;
            })
            .join('')}
        </div>

        <button
          class="yotpo-reviews__page-btn yotpo-reviews__page-btn--next"
          on:click="/goToPage?page=${currentPage + 1}"
          ${currentPage === totalPages ? 'disabled' : ''}
          aria-label="Next page"
        >
          <span>Next</span>
          <svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </button>
      </nav>
    `;
  }

  /**
   * Generate page numbers for pagination
   * @param {number} current
   * @param {number} total
   * @returns {(number | string)[]}
   */
  #generatePageNumbers(current, total) {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = [];

    if (current <= 4) {
      pages.push(1, 2, 3, 4, 5, '...', total);
    } else if (current >= total - 3) {
      pages.push(1, '...', total - 4, total - 3, total - 2, total - 1, total);
    } else {
      pages.push(1, '...', current - 1, current, current + 1, '...', total);
    }

    return pages;
  }

  /**
   * Navigate to a specific page
   * @param {{ page: number }} data
   */
  goToPage(data) {
    const totalPages = this.#pagination ? Math.ceil(this.#pagination.total / this.#perPage) : 1;

    if (data.page < 1 || data.page > totalPages) return;

    this.#currentPage = data.page;
    this.#fetchReviews();

    // Scroll to top of reviews
    this.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} str
   * @returns {string}
   */
  #escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

if (!customElements.get('yotpo-reviews')) {
  customElements.define('yotpo-reviews', YotpoReviews);
}
