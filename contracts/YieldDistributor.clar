(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-FARM-NOT-FOUND u101)
(define-constant ERR-INVALID-REVENUE u102)
(define-constant ERR-INVALID-TOTAL-SUPPLY u103)
(define-constant ERR-NO-PENDING-YIELD u104)
(define-constant ERR-ORACLE-NOT-AUTHORIZED u105)
(define-constant ERR-ALREADY-DISTRIBUTED u106)
(define-constant ERR-INVALID-FARM-ID u107)
(define-constant ERR-ZERO-SHARES u108)

(define-data-var oracle-principal principal tx-sender)
(define-data-var distribution-nonce uint u0)

(define-map farms
  uint
  {
    total-supply: uint,
    total-revenue: uint,
    last-distributed: uint,
    accumulated-yield-per-share: uint
  }
)

(define-map investor-yields
  { farm-id: uint, investor: principal }
  {
    claimed-yield-per-share: uint,
    pending-yield: uint
  }
)

(define-map revenue-updates
  uint
  {
    kwh-produced: uint,
    price-per-kwh: uint,
    revenue: uint,
    block-height: uint
  }
)

(define-read-only (get-farm (farm-id uint))
  (map-get? farms farm-id)
)

(define-read-only (get-pending-yield (farm-id uint) (investor principal))
  (default-to 
    { claimed-yield-per-share: u0, pending-yield: u0 }
    (map-get? investor-yields { farm-id: farm-id, investor: investor })
  )
)

(define-read-only (get-total-revenue (farm-id uint))
  (get total-revenue (unwrap! (get-farm farm-id) (err ERR-FARM-NOT-FOUND)))
)

(define-read-only (calculate-yield-share (farm-id uint) (shares uint))
  (let (
        (farm (unwrap! (get-farm farm-id) (err ERR-FARM-NOT-FOUND)))
        (total-supply (get total-supply farm))
      )
    (if (is-eq total-supply u0)
        (ok u0)
        (let (
              (new-yield-per-share (get accumulated-yield-per-share farm))
              (investor-data (get-pending-yield farm-id tx-sender))
              (owed-per-share (- new-yield-per-share (get claimed-yield-per-share investor-data)))
            )
          (ok (/ (* shares owed-per-share) u1000000))
        )
      )
  )
)

(define-private (update-investor-yield (farm-id uint) (investor principal) (shares uint))
  (let (
        (farm (unwrap! (get-farm farm-id) (err ERR-FARM-NOT-FOUND)))
        (total-supply (get total-supply farm))
        (investor-data (get-pending-yield farm-id investor))
        (current-ayps (get accumulated-yield-per-share farm))
        (owed-per-share (- current-ayps (get claimed-yield-per-share investor-data)))
        (pending (/ (* shares owed-per-share) u1000000))
      )
    (map-set investor-yields
      { farm-id: farm-id, investor: investor }
      {
        claimed-yield-per-share: current-ayps,
        pending-yield: (+ (get pending-yield investor-data) pending)
      }
    )
    (ok pending)
  )
)

(define-public (register-farm (farm-id uint) (initial-supply uint))
  (begin
    (asserts! (> initial-supply u0) (err ERR-INVALID-TOTAL-SUPPLY))
    (asserts! (is-none (get-farm farm-id)) (err ERR-FARM-NOT-FOUND))
    (map-set farms farm-id
      {
        total-supply: initial-supply,
        total-revenue: u0,
        last-distributed: u0,
        accumulated-yield-per-share: u0
      }
    )
    (ok true)
  )
)

(define-public (update-shares (farm-id uint) (investor principal) (new-shares uint))
  (let (
        (farm (unwrap! (get-farm farm-id) (err ERR-FARM-NOT-FOUND)))
      )
    (try! (update-investor-yield farm-id investor (get total-supply farm)))
    (map-set farms farm-id
      (merge farm { total-supply: new-shares })
    )
    (ok true)
  )
)

(define-public (submit-revenue (farm-id uint) (kwh-produced uint) (price-per-kwh uint))
  (let (
        (revenue (* kwh-produced price-per-kwh))
        (farm (unwrap! (get-farm farm-id) (err ERR-FARM-NOT-FOUND)))
        (total-supply (get total-supply farm))
      )
    (asserts! (is-eq tx-sender (var-get oracle-principal)) (err ERR-ORACLE-NOT-AUTHORIZED))
    (asserts! (> revenue u0) (err ERR-INVALID-REVENUE))
    (asserts! (> total-supply u0) (err ERR-ZERO-SHARES))
    
    (let (
          (additional-yield-per-share (/ (* revenue u1000000) total-supply))
          (new-ayps (+ (get accumulated-yield-per-share farm) additional-yield-per-share))
        )
      (map-set farms farm-id
        (merge farm
          {
            total-revenue: (+ (get total-revenue farm) revenue),
            accumulated-yield-per-share: new-ayps
          }
        )
      )
      (map-set revenue-updates (var-get distribution-nonce)
        {
          kwh-produced: kwh-produced,
          price-per-kwh: price-per-kwh,
          revenue: revenue,
          block-height: block-height
        }
      )
      (var-set distribution-nonce (+ (var-get distribution-nonce) u1))
      (ok revenue)
    )
  )
)

(define-public (claim-yield (farm-id uint))
  (let (
        (investor-data (get-pending-yield farm-id tx-sender))
        (pending (get pending-yield investor-data))
        (farm (unwrap! (get-farm farm-id) (err ERR-FARM-NOT-FOUND)))
      )
    (asserts! (> pending u0) (err ERR-NO-PENDING-YIELD))
    
    (map-set investor-yields
      { farm-id: farm-id, investor: tx-sender }
      {
        claimed-yield-per-share: (get accumulated-yield-per-share farm),
        pending-yield: u0
      }
    )
    (try! (stx-transfer? pending tx-sender (as-contract tx-sender)))
    (ok pending)
  )
)

(define-public (set-oracle (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get oracle-principal)) (err ERR-NOT-AUTHORIZED))
    (var-set oracle-principal new-oracle)
    (ok true)
  )
)